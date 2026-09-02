/*
 * Mnova 15 bridge for mnova-mcp.
 * The Python MCP server passes one JSON request path through -sf.
 */

function readText(path) {
    var file = new File(path);
    if (!file.open(File.ReadOnly)) {
        throw new Error("Cannot read: " + path);
    }
    var stream = new TextStream(file);
    stream.codec = "UTF-8";
    var text = stream.readAll();
    file.close();
    return text;
}

function writeText(path, text) {
    var file = new File(path);
    if (!file.open(File.WriteOnly)) {
        throw new Error("Cannot write: " + path);
    }
    var stream = new TextStream(file);
    stream.codec = "UTF-8";
    stream.write(text);
    file.close();
}

function safeParam(spec, name) {
    try {
        return spec.getParam(name, true);
    } catch (error) {
        return null;
    }
}

function safeValue(callback, fallback) {
    try {
        var value = callback();
        return value === undefined ? fallback : value;
    } catch (error) {
        return fallback;
    }
}

function jsonClone(value) {
    try {
        return JSON.parse(JSON.stringify(value));
    } catch (error) {
        return String(value);
    }
}

function asciiJson(value, indent) {
    return JSON.stringify(value, null, indent).replace(
        /[^\x00-\x7F]/g,
        function (character) {
            var hex = character.charCodeAt(0).toString(16);
            while (hex.length < 4) {
                hex = "0" + hex;
            }
            return "\\u" + hex;
        }
    );
}

function runAction(name, warnings) {
    try {
        mainWindow.doAction(name);
    } catch (error) {
        warnings.push(name + ": " + error);
    }
}

function configureAnalysis(spec, warnings) {
    try {
        var processing = new NMRProcessing(spec.proc);
        processing.setParameter("pp.apply", true);
        processing.setParameter("integration.apply", true);
        processing.setParameter("integration.method", "Auto");
        processing.setParameter("integration.auto.algorithm", "PeakPicking");
        processing.setParameter("mult.apply", true);
        spec.proc = processing;
        spec.process();
    } catch (error) {
        warnings.push("parameter-based analysis: " + error);
    }
    runAction("nmrAutoPeakPicking", warnings);
    runAction("nmrMultipletsAuto", warnings);
}

function activeSpectrum1D() {
    var spec = new NMRSpectrum(nmr.activeSpectrum());
    if (!spec.isValid()) {
        throw new Error("No active NMR spectrum after import");
    }
    if (spec.dimCount != 1) {
        throw new Error("Only 1D NMR is supported");
    }
    return spec;
}

function activeMolecule() {
    var mol = new Molecule(Application.molecule.activeMolecule());
    if (!mol.isValid()) {
        throw new Error("No active molecule after structure import");
    }
    return mol;
}

function peakData(spec) {
    var peaks = spec.peaks();
    var output = [];
    for (var i = 0; i < peaks.count; ++i) {
        var peak = peaks.at(i);
        output.push({
            id: peak.id,
            ppm: peak.delta(),
            intensity: peak.intensity,
            width_ppm: peak.width(),
            integral: peak.integral,
            annotation: peak.annotation,
            type: peak.type,
            flags: peak.flags
        });
    }
    return output;
}

function integralData(spec) {
    var integrals = spec.integrals();
    var output = [];
    for (var i = 0; i < integrals.count; ++i) {
        var integral = new Integral(integrals.at(i));
        output.push({
            range_min_ppm: integral.rangeMin(1),
            range_max_ppm: integral.rangeMax(1),
            value: integral.integralValue(),
            normalized_value: integral.integralValue(integrals.normValue)
        });
    }
    return output;
}

function jValues(multiplet) {
    var values = [];
    try {
        var list = multiplet.jList(false);
        for (var i = 0; i < list.count; ++i) {
            values.push(list.at(i));
        }
    } catch (error) {
        /* Some multiplets do not have measurable J values. */
    }
    return values;
}

function multipletData(spec, integrals) {
    var multiplets = spec.multiplets();
    var output = [];
    for (var i = 0; i < multiplets.count; ++i) {
        var multiplet = multiplets.at(i);
        output.push({
            uuid: multiplet.uuid,
            name: multiplet.name,
            ppm: multiplet.delta,
            centroid_ppm: multiplet.centroid,
            range_min_ppm: multiplet.rangeMin,
            range_max_ppm: multiplet.rangeMax,
            category: multiplet.category,
            nH: multiplet.nH,
            integral: multiplet.integralValue(integrals.normValue),
            j_hz: jValues(multiplet),
            peak_count: multiplet.peaks ? multiplet.peaks.length : null
        });
    }
    return output;
}

function spectrumData(spec) {
    return {
        dimensions: spec.dimCount,
        nucleus: spec.nucleus(),
        frequency_mhz: spec.frequency(),
        point_count: spec.count(),
        scale_width_hz: spec.scaleWidth(),
        solvent: safeParam(spec, "Solvent")
    };
}

function moleculeData(mol) {
    return {
        atom_count: mol.atomCount,
        bond_count: mol.bondCount,
        molecule_id: safeValue(function () { return mol.moleculeId; }, null),
        smiles: safeValue(function () { return mol.generateSMILES(); }, null),
        inchi: safeValue(function () { return mol.generateInChi(); }, null)
    };
}

function atomData(mol) {
    var output = [];
    var assignmentModel = new NMRAssignments(mol);
    for (var i = 1; i <= mol.atomCount; ++i) {
        var atom = new Atom(mol.atom(i));
        output.push({
            index: i,
            number: atom.number,
            element: atom.elementSymbol,
            text: atom.text,
            alias: atom.alias,
            nH: atom.nH,
            nH_all: atom.nHAll,
            proton_notation: atom.protonNotation,
            isotope: atom.isotope,
            charge: atom.charge,
            labile_proton: safeValue(function () { return mol.isLabileProton(i); }, false),
            non_equivalent_h_indices: safeValue(
                function () { return jsonClone(assignmentModel.notEqHs(i)); },
                []
            ),
            symmetrical_atom_indices: safeValue(
                function () { return jsonClone(mol.symmetricalAtoms(i)); },
                []
            )
        });
    }
    return output;
}

function serializeVerificationMessage(message) {
    return {
        type: message.type,
        message: message.message,
        description: message.description,
        advice: message.advice,
        context: message.context,
        hidden: message.hidden,
        params: jsonClone(message.params)
    };
}

function serializeVerificationTest(test) {
    return {
        id: test.id,
        name: test.name,
        score: test.score,
        quality: test.quality,
        significance: test.significance,
        ext_data: jsonClone(test.extData)
    };
}

function serializeVerificationResult(result) {
    var messages = [];
    var tests = [];
    var i;
    if (result.messages) {
        for (i = 0; i < result.messages.length; ++i) {
            messages.push(serializeVerificationMessage(result.messages[i]));
        }
    }
    if (result.testsResults) {
        for (i = 0; i < result.testsResults.length; ++i) {
            tests.push(serializeVerificationTest(result.testsResults[i]));
        }
    }
    return {
        status: "completed",
        id: result.id,
        begin_date: String(result.beginDate),
        score: result.score,
        quality: result.quality,
        significance: result.significance,
        prior_confidence: result.priorConfidence,
        tests: tests,
        messages: messages,
        interpretation_note: (
            "Mnova Verify scores are decision support, not standalone proof of identity."
        )
    };
}

function verificationData(spec, mol, enabled, warnings) {
    if (!enabled) {
        return {status: "skipped", reason: "disabled_by_request"};
    }
    if (typeof ASV === "undefined" || !Application.ASV) {
        return {
            status: "unavailable",
            reason: "Mnova Verify/ASV plugin is not available in this installation or license"
        };
    }
    try {
        var result = ASV.verify([spec], mol);
        if (result === undefined || result === null) {
            return {status: "unavailable", reason: "Mnova Verify returned no result"};
        }
        return serializeVerificationResult(result);
    } catch (error) {
        warnings.push("Mnova Verify: " + error);
        return {
            status: "failed",
            reason: String(error),
            license_error: error && error.license ? true : false
        };
    }
}

function exportSpectrum(spec, outputPath) {
    var converter = new CSVNMRConverter();
    converter.setDefaultSettings();
    converter.exportItems(spec, outputPath);
}

function commonEvidence(request, spec, warnings) {
    var integrals = spec.integrals();
    return {
        schema_version: "1.1",
        status: "ok",
        operation: request.operation,
        job_id: request.job_id,
        mnova: {version: Application.version.full, name: Application.name},
        processing: {
            mode: request.operation === "apply_assignments_1d" ?
                "reopened_prepared_document" :
                (request.processing_template_path ?
                    "template_plus_auto_analysis" : "automatic_plus_auto_analysis"),
            template_path: request.processing_template_path,
            warnings: warnings
        },
        spectrum: spectrumData(spec),
        peaks: peakData(spec),
        integrals: integralData(spec),
        multiplets: multipletData(spec, integrals),
        warnings: warnings
    };
}

function process1D(request, warnings) {
    var opened = serialization.open(request.input_path);
    if (opened === false) {
        throw new Error("Mnova could not open input: " + request.input_path);
    }
    var spec = activeSpectrum1D();
    if (request.processing_template_path) {
        nmr.process(request.processing_template_path);
    }
    configureAnalysis(spec, warnings);
    spec.update();

    var outputDir = request.output_dir;
    var spectrumCsv = outputDir + "/spectrum.csv";
    var pdfPath = outputDir + "/spectrum.pdf";
    var mnovaPath = outputDir + "/processed.mnova";
    exportSpectrum(spec, spectrumCsv);
    serialization.save(pdfPath, "pdf");
    serialization.save(mnovaPath, "mnova");

    var response = commonEvidence(request, spec, warnings);
    response.input = {path: request.input_path};
    response.artifacts = {
        analysis_json: outputDir + "/analysis.json",
        spectrum_csv: spectrumCsv,
        pdf: pdfPath,
        mnova: mnovaPath
    };
    return response;
}

function prepareStructure1D(request, warnings) {
    var opened = serialization.open([request.input_path, request.structure_path]);
    if (opened === false) {
        throw new Error(
            "Mnova could not open NMR and structure inputs: " +
            request.input_path + ", " + request.structure_path
        );
    }
    var spec = activeSpectrum1D();
    var mol = activeMolecule();
    if (request.processing_template_path) {
        nmr.process(request.processing_template_path);
    }
    configureAnalysis(spec, warnings);
    spec.update();
    mol.update();

    var outputDir = request.output_dir;
    var spectrumCsv = outputDir + "/spectrum.csv";
    var pdfPath = outputDir + "/prepared.pdf";
    var mnovaPath = outputDir + "/prepared.mnova";
    var planTemplatePath = outputDir + "/assignment-plan.template.json";
    var verification = verificationData(
        spec, mol, request.run_verification === true, warnings
    );

    exportSpectrum(spec, spectrumCsv);
    serialization.save(pdfPath, "pdf");
    serialization.save(mnovaPath, "mnova");

    var response = commonEvidence(request, spec, warnings);
    response.input = {
        nmr_path: request.input_path,
        structure_path: request.structure_path
    };
    response.molecule = moleculeData(mol);
    response.atoms = atomData(mol);
    response.verification = verification;
    response.assignment_contract = {
        link_type: "Multiplet",
        label_field: "assignments[].label",
        label_format: "lowercase letters; combine coincident labels with comma and no spaces",
        label_position: "horizontally centered directly above the assigned peak",
        label_color: "#0000FF",
        atom_index_source: "atoms[].index",
        proton_index_source: "atoms[].non_equivalent_h_indices",
        multiplet_id_source: "multiplets[].uuid",
        low_confidence_policy: "keep in unresolved unless explicitly allowed"
    };
    response.artifacts = {
        analysis_json: outputDir + "/analysis.json",
        assignment_plan_template: planTemplatePath,
        spectrum_csv: spectrumCsv,
        pdf: pdfPath,
        mnova: mnovaPath
    };

    writeText(planTemplatePath, asciiJson({
        schema_version: "1.1",
        source_job_id: request.job_id,
        source_analysis_path: outputDir + "/analysis.json",
        assignments: [],
        unresolved: [],
        notes: [
            "Use real atoms[].index and multiplets[].uuid values from analysis.json.",
            "Give every assignment one lowercase letter label (a, b, ... z, aa, ab, ...).",
            "Reuse a label only for chemically equivalent sites linked to the same multiplet.",
            "Record confidence and evidence for every proposed assignment.",
            "Keep solvent, impurity, overlap, and low-confidence signals in unresolved."
        ]
    }, 2));
    return response;
}

function findMultipletByUuid(spec, uuid) {
    var multiplets = spec.multiplets();
    for (var i = 0; i < multiplets.count; ++i) {
        var multiplet = multiplets.at(i);
        if (multiplet.uuid === uuid) {
            return multiplet;
        }
    }
    return null;
}

function containsValue(array, value) {
    if (!array) {
        return false;
    }
    for (var i = 0; i < array.length; ++i) {
        if (String(array[i]) === String(value)) {
            return true;
        }
    }
    return false;
}

function protonLabel(hIndex) {
    if (typeof hIndex === "number" && hIndex >= 1 && hIndex <= 26) {
        return String.fromCharCode(96 + hIndex);
    }
    if (typeof hIndex === "string" && /^\d+$/.test(hIndex)) {
        var numeric = parseInt(hIndex, 10);
        if (numeric >= 1 && numeric <= 26) {
            return String.fromCharCode(96 + numeric);
        }
    }
    return hIndex;
}

function buildMnovaAssignments(spec, mol, plan) {
    var output = [];
    var assignmentModel = new NMRAssignments(mol);
    var nucleus = String(spec.nucleus());
    for (var i = 0; i < plan.assignments.length; ++i) {
        var source = plan.assignments[i];
        if (source.atom_index < 1 || source.atom_index > mol.atomCount) {
            throw new Error(
                "Assignment " + i + " has atom_index outside molecule: " +
                source.atom_index
            );
        }
        var multiplet = findMultipletByUuid(spec, source.multiplet_uuid);
        if (multiplet === null) {
            throw new Error(
                "Assignment " + i + " references missing multiplet UUID: " +
                source.multiplet_uuid
            );
        }
        var hIndex = source.h_index;
        var nonEquivalentHs = assignmentModel.notEqHs(source.atom_index);
        if ((hIndex === undefined || hIndex === null) && nucleus.indexOf("1H") >= 0) {
            if (nonEquivalentHs && nonEquivalentHs.length === 1) {
                hIndex = nonEquivalentHs[0];
            } else {
                throw new Error(
                    "Assignment " + i + " needs explicit h_index for a 1H spectrum"
                );
            }
        }
        if (hIndex !== undefined && hIndex !== null &&
                nonEquivalentHs && nonEquivalentHs.length &&
                !containsValue(nonEquivalentHs, hIndex)) {
            throw new Error(
                "Assignment " + i + " uses h_index not listed for atom " +
                source.atom_index + ": " + hIndex
            );
        }

        var atomRef = {index: source.atom_index};
        if (hIndex !== undefined && hIndex !== null) {
            // notEqHs() reports 1-based indices, while setNMRAssignments()
            // represents attached proton sites as a/b/c labels.
            atomRef.h = protonLabel(hIndex);
        }
        output.push({
            atom: atomRef,
            shift: [{
                shift: source.ppm,
                min: Math.min(source.range_min_ppm, source.range_max_ppm),
                max: Math.max(source.range_min_ppm, source.range_max_ppm),
                idTypes: [{type: "Multiplet", uuid: source.multiplet_uuid}]
            }]
        });
    }
    return output;
}

function showAssignments(spec, mol, warnings) {
    try {
        var activeWindow = new DocumentWindow(mainWindow.activeWindow());
        activeWindow.setSelection([spec, mol]);
    } catch (error) {
        warnings.push("select spectrum and molecule: " + error);
    }
    runAction("nmrAssignmentsShow", warnings);
}

function appendUnique(array, value) {
    if (!containsValue(array, value)) {
        array.push(value);
    }
}

function letterLabelMaps(plan) {
    var atoms = {};
    var multiplets = {};
    var i;
    for (i = 0; i < plan.assignments.length; ++i) {
        var assignment = plan.assignments[i];
        var atomKey = String(assignment.atom_index);
        if (!atoms[atomKey]) {
            atoms[atomKey] = [];
        }
        appendUnique(atoms[atomKey], assignment.label);
        if (!multiplets[assignment.multiplet_uuid]) {
            multiplets[assignment.multiplet_uuid] = [];
        }
        appendUnique(multiplets[assignment.multiplet_uuid], assignment.label);
    }
    return {atoms: atoms, multiplets: multiplets};
}

function representativePeak(spec, multiplet) {
    var ids = multiplet.peaks || [];
    var peaks = spec.peaks();
    var selected = null;
    var selectedHeight = -1;
    var i;
    for (i = 0; i < peaks.count; ++i) {
        var peak = peaks.at(i);
        var isMember = containsValue(ids, peak.id) ||
            containsValue(ids, safeValue(function () { return peak.uuid; }, ""));
        var ppm = peak.delta();
        var inRange = ppm >= Math.min(multiplet.rangeMin, multiplet.rangeMax) &&
            ppm <= Math.max(multiplet.rangeMin, multiplet.rangeMax);
        if (!isMember && !inRange) {
            continue;
        }
        var height = Math.abs(peak.intensity);
        if (height > selectedHeight) {
            selected = peak;
            selectedHeight = height;
        }
    }
    return selected;
}

function drawPeakLetterLabel(spec, label, peak, warnings) {
    try {
        var coords = spec.scaleToPage({x: peak.delta(), y: peak.intensity});
        if (coords === undefined || coords === null) {
            throw new Error("peak is outside the current spectrum display");
        }
        var textItem = new Text(Application.draw.text(label, true));
        textItem.htmlText =
            "<span style=\"color:#0000FF;font-family:Arial;font-size:11pt\">" +
            label + "</span>";
        var targetLeft = coords.x - textItem.width / 2.0;
        var targetTop = coords.y - textItem.height - 1.0;
        textItem.translate(targetLeft - textItem.left, targetTop - textItem.top);
        textItem.update();
        return {
            label: label,
            representative_peak_id: peak.id,
            ppm: peak.delta(),
            position: "above_peak"
        };
    } catch (error) {
        warnings.push("draw peak letter label " + label + ": " + error);
        return {label: label, status: "not_drawn", reason: String(error)};
    }
}

function applyLetterLabels(spec, mol, plan, warnings) {
    var maps = letterLabelMaps(plan);
    var moleculeLabels = [];
    var spectrumLabels = [];
    var atomKey;
    var atomIndex;
    for (atomIndex = 1; atomIndex <= mol.atomCount; ++atomIndex) {
        mol.atom(atomIndex).number = "";
    }
    for (atomKey in maps.atoms) {
        if (!maps.atoms.hasOwnProperty(atomKey)) {
            continue;
        }
        var atomLabel = maps.atoms[atomKey].join(",");
        mol.atom(parseInt(atomKey, 10)).number = atomLabel;
        moleculeLabels.push({atom_index: parseInt(atomKey, 10), label: atomLabel});
    }
    try {
        var properties = mol.graphicProperties();
        properties.atomFontColor = "black";
        properties.numberFontColor = "blue";
        properties.showLabel = true;
        mol.setGraphicProperties(properties);
        mol.setGraphicProperties({
            atomFontColor: "black",
            numberFontColor: "blue",
            showLabel: true
        });
    } catch (error) {
        warnings.push("style molecule letter labels: " + error);
    }
    try {
        spec.setProperty("multiplets.show", false);
    } catch (error) {
        warnings.push("hide multiplet detail boxes: " + error);
    }
    var multiplets = spec.multiplets();
    for (var i = 0; i < multiplets.count; ++i) {
        var multiplet = multiplets.at(i);
        var labels = maps.multiplets[multiplet.uuid];
        if (!labels || !labels.length) {
            continue;
        }
        var joined = labels.join(",");
        var peak = representativePeak(spec, multiplet);
        if (peak === null) {
            warnings.push("no representative peak found for letter label " + joined);
            spectrumLabels.push({
                multiplet_uuid: multiplet.uuid,
                label: joined,
                status: "not_drawn",
                reason: "no representative peak"
            });
            continue;
        }
        var display = drawPeakLetterLabel(spec, joined, peak, warnings);
        display.multiplet_uuid = multiplet.uuid;
        spectrumLabels.push(display);
    }
    mol.update();
    spec.update();
    mainWindow.activeDocument.update();
    return {
        molecule: moleculeLabels,
        spectrum: spectrumLabels,
        style: {
            letter_case: "lowercase",
            separator: ",",
            color: "#0000FF",
            position: "directly_above_peak"
        }
    };
}

function applyAssignments1D(request, warnings) {
    var opened = serialization.open(request.prepared_mnova_path);
    if (opened === false) {
        throw new Error(
            "Mnova could not open prepared document: " + request.prepared_mnova_path
        );
    }
    var spec = activeSpectrum1D();
    var mol = activeMolecule();
    var plan = request.assignment_plan;
    var assignments = buildMnovaAssignments(spec, mol, plan);
    mol.setNMRAssignments(assignments, true);
    mol.update();
    spec.update();

    var verification = verificationData(
        spec, mol, request.run_verification === true, warnings
    );
    // Mnova Verify may calculate and install its own best assignment. Restore
    // the audited plan so the saved document contains exactly what was approved.
    assignments = buildMnovaAssignments(spec, mol, plan);
    mol.setNMRAssignments(assignments, true);
    mol.update();
    spec.update();
    runAction("nmrAssignmentsHide", warnings);
    var displayLabels = applyLetterLabels(spec, mol, plan, warnings);
    var outputDir = request.output_dir;
    var pdfPath = outputDir + "/assigned.pdf";
    var mnovaPath = outputDir + "/assigned.mnova";
    var assignmentJsonPath = outputDir + "/assignments.applied.json";
    var assignmentCsvPath = outputDir + "/assignments.applied.csv";
    var verificationPath = outputDir + "/verification.json";

    writeText(assignmentJsonPath, asciiJson({
        schema_version: "1.1",
        source_plan_path: request.assignment_plan_source_path,
        source_plan: plan,
        mnova_assignments: jsonClone(mol.nmrAssignments())
    }, 2));
    writeText(verificationPath, asciiJson(verification, 2));
    serialization.save(pdfPath, "pdf");
    serialization.save(mnovaPath, "mnova");

    var response = commonEvidence(request, spec, warnings);
    response.input = {
        prepared_mnova_path: request.prepared_mnova_path,
        assignment_plan_path: request.assignment_plan_source_path
    };
    response.molecule = moleculeData(mol);
    response.atoms = atomData(mol);
    response.assignments = jsonClone(mol.nmrAssignments());
    response.display_labels = displayLabels;
    response.applied_assignment_count = plan.assignments.length;
    response.unresolved = plan.unresolved || [];
    response.verification = verification;
    response.artifacts = {
        analysis_json: outputDir + "/analysis.json",
        assignments_json: assignmentJsonPath,
        assignments_csv: assignmentCsvPath,
        verification_json: verificationPath,
        pdf: pdfPath,
        mnova: mnovaPath
    };
    return response;
}

function runJob(requestPath) {
    var request = null;
    var response = null;
    var warnings = [];
    var documentWindow = null;
    try {
        request = JSON.parse(readText(requestPath));
        request.operation = request.operation || "process_1d";
        documentWindow = new DocumentWindow(Application.mainWindow.newWindow());
        if (request.operation === "process_1d") {
            response = process1D(request, warnings);
        } else if (request.operation === "prepare_structure_1d") {
            response = prepareStructure1D(request, warnings);
        } else if (request.operation === "apply_assignments_1d") {
            response = applyAssignments1D(request, warnings);
        } else {
            throw new Error("Unsupported operation: " + request.operation);
        }

        writeText(
            request.output_dir + "/analysis.json",
            asciiJson(response, 2)
        );
        writeText(request.response_path, asciiJson(response, 2));
        if (documentWindow) {
            documentWindow.close();
        }
        Application.setExitStatus(0);
    } catch (error) {
        response = {
            schema_version: "1.1",
            status: "error",
            operation: request && request.operation ? request.operation : null,
            job_id: request && request.job_id ? request.job_id : null,
            error: String(error),
            warnings: warnings
        };
        if (request && request.response_path) {
            writeText(request.response_path, asciiJson(response, 2));
        }
        if (documentWindow) {
            try {
                documentWindow.close();
            } catch (closeError) {
                /* Keep the original error. */
            }
        }
        Application.setExitStatus(1);
    }
}
