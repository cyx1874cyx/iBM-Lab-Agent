/**
 * Strict-enough OOXML package validation for artifacts crossing Linux → Windows.
 * A .docx/.pptx is accepted only when it is a readable ZIP with the required
 * content-type declaration and main Office part. This prevents HTML/error text,
 * truncated RPC payloads, and renamed non-Office files from being downloaded.
 */

import { createHash } from "node:crypto";
import JSZip from "jszip";

const DEFINITIONS = {
	docx: {
		mime: "application/vnd.openxmlformats-officedocument.wordprocessingml.document",
		mainPart: "word/document.xml",
		mainContentType: "application/vnd.openxmlformats-officedocument.wordprocessingml.document.main+xml",
		mainMarker: /<w:document\b/,
		required: ["[Content_Types].xml", "_rels/.rels", "word/document.xml"]
	},
	pptx: {
		mime: "application/vnd.openxmlformats-officedocument.presentationml.presentation",
		mainPart: "ppt/presentation.xml",
		mainContentType: "application/vnd.openxmlformats-officedocument.presentationml.presentation.main+xml",
		mainMarker: /<p:presentation\b/,
		required: ["[Content_Types].xml", "_rels/.rels", "ppt/presentation.xml", "ppt/_rels/presentation.xml.rels"]
	}
};

function bytesOf(value) {
	if (Buffer.isBuffer(value)) return value;
	if (value instanceof Uint8Array) return Buffer.from(value.buffer, value.byteOffset, value.byteLength);
	throw new Error("Office artifact must be a Buffer or Uint8Array");
}

/** Validate a DOCX/PPTX and return immutable download metadata. */
export async function inspectOfficePackage(value, kind) {
	const def = DEFINITIONS[kind];
	if (def === undefined) throw new Error(`unsupported Office package kind '${kind}'`);
	const buffer = bytesOf(value);
	if (buffer.length < 4 || buffer.subarray(0, 4).toString("latin1") !== "PK\x03\x04") {
		throw new Error(`${kind.toUpperCase()} is not a ZIP/OOXML package`);
	}
	let zip;
	try {
		zip = await JSZip.loadAsync(buffer);
	} catch (error) {
		throw new Error(`${kind.toUpperCase()} ZIP is unreadable: ${error.message}`);
	}
	for (const part of def.required) {
		if (zip.file(part) === null) throw new Error(`${kind.toUpperCase()} is missing required part '${part}'`);
	}
	const contentTypes = await zip.file("[Content_Types].xml").async("string");
	if (!contentTypes.includes(def.mainContentType)) {
		throw new Error(`${kind.toUpperCase()} main content type is missing or incorrect`);
	}
	const mainXml = await zip.file(def.mainPart).async("string");
	if (!def.mainMarker.test(mainXml)) throw new Error(`${kind.toUpperCase()} main XML part is malformed`);
	let slides;
	if (kind === "pptx") {
		slides = Object.keys(zip.files).filter((name) => /^ppt\/slides\/slide\d+\.xml$/.test(name)).length;
		if (slides === 0) throw new Error("PPTX contains no slides");
	}
	return {
		kind,
		mime: def.mime,
		byteLength: buffer.length,
		sha256: createHash("sha256").update(buffer).digest("hex"),
		...(slides === undefined ? {} : { slides })
	};
}

export default inspectOfficePackage;
