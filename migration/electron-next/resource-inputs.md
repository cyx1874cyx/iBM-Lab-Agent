# P0 运行时输入锁定

| 资源 | 固定值 | 输入 |
| --- | --- | --- |
| Python | 3.12.11 | runtime/versions.env；Windows recipe |
| 旧 Node | 24.16.0 | 旧业务基线，NEXT 优先复用 Electron Node-mode |
| Origin MCP | 0.1.4 | fecb7226ed60d7651d921d2586eb9950bf16b618 |
| Mnova MCP | 0.3.1 | e015c3424e7165dc9aa518d63d8195f643f4f169 |
| MCP SDK | 1.29.0 | python/requirements.lock |
| Nature Skills | c171989db699bd601d4373912b3fb8db96ecc95b | vendor.lock.json 与已提交 vendor tree |

**关键源码输入 SHA-256**

| 组件 | 输入 | SHA-256（Git 原始 blob） |
| --- | --- | --- |
| iBM | package.json | c9abe6cd56d0c0a8bbfa8423074ffbe227fbfaf6d7c429c181a8d1a5d1d62622 |
| iBM | pnpm-lock.yaml | b1a14f0fc8cde6e9bc6ae236a6743b2b4a8f7acbfd06f7aebf8093b9451e603f |
| iBM | package-lock.json | d536cebff170998c678956d5878c3114e79eb733847adffe45247f9887e0bb2a |
| iBM | pnpm-workspace.yaml | ff290414ea7fee9a694aa8f2cbd9f1041908b640abce168ce984dcb2b43fd5ae |
| iBM | harness.lock.json | 514c76a96f165aa00f3e353e9c1ab11d662edd92c526b284cd1a442d29f9d0c8 |
| iBM | runtime/versions.env | 7c5530b8622511d3a2e85efc7d88ae1639328fc79073ff8fedb504fb618b15d7 |
| iBM | runtime/launcher/package.json | 5a6498d68608cc8ba9166144f5b881fcb10d02ad7a23346a78b20f9741ffe1ae |
| iBM | runtime/launcher/pnpm-lock.yaml | ae979af21860d7c0ee5b26983edc0a5308fb78b70559b8354f6d813523647f1f |
| iBM | vendor.lock.json | 8dc1ccf733ab7e4eb35908470f270a7d5f301c65fbe0d1710876cee8fa9b1ef8 |
| iBM | vendor.manifest.json | f0e348ee56c5419b1fc38d426aa8f3911ebf6c6d7b5cde3b3e59a637746a1ea0 |
| iBM | python/requirements.lock | 307fe9277f212db1c82c484dc5adbc378dc681f7b3abc6cee1ef96d541198d2d |
| iBM | python/requirements-linux.lock | 968e2b1fce4a43dcddf26fbf0fa8fe61b748cf7d592ac9d90acae09bdd485a71 |
| iBM | desktop/docs/release-manifest.json | 741eadcab9accaf5d5b8c66d978ec65fcf08254dad2f4b651bcbf9c1d4aa47bd |
| iBM | desktop/src-tauri/tauri.conf.json | f31ecd9356baac0e36e85c015d3cc32006b2e8f83174f52152788cff7bf25819 |
| iBM | desktop/scripts/build-bundled-python.ps1 | 3ff28f0b3ebf51782ae18874315b8242a1a0b5ac6d3b4bf7ee619c55e469c496 |
| iBM | desktop/scripts/prepare-runtime.ps1 | b5cbd46c29676210af9007c7b63ee7c59ed7055f7d013a182b0b1d2589d7da21 |
| iBM | desktop/scripts/build-windows-release.ps1 | 5bcb054eacdf677256998d7b3048a682332613e19bcbeeb74b2f26d88301e3db |
| iBM | scripts/bundled-python-inputs.mjs | b625ef87e73e671c6d54635f4acf712524a517206d92252279bfe421c75c4c9e |
| iBM | src/python-lock-hash.js | e1c7c6d8e6afec83d701d18b7463276c8ce6b3276ca448b82f0654450df178a8 |
| iBM | src/markitdown-patch.js | dad703558ff22d9db7ee169a3d672163f771f12a402d73e848974c37228833fe |
| iBM | scripts/patch-markitdown.mjs | 0652eb2f9cb297cd50eb8744bf79ee7eec3153cd37abf0aade0cc65c92e4bd5c |
| iBM | src/dsh-runtime-patch.js | 00e0bd5925668f5a84262774b1092e75b0f0e3f8083f57ef7281e31d574b72dc |
| iBM | src/dsh-web-frontend-patch.js | bb2d750adb04fa1c9303666f56d36790f3871556ab817ad1f6e231d2a6c478d4 |
| iBM | cordis.patch.yml | 852cf580d9f5bc3a3eff8f2d413cdfd4470d9c2377569c14af2b93e1b6f46835 |
| iBM | presets/lab-research/preset.patch.yml | e78e66678bb2fd2369e0e5eb967370a184eaacf9242768c3594b636e20c763f6 |
| iBM | client/src/descriptors.js | 6a50a2cb40d203f65b7529cb4756468c0ba37594865ad085bdfab7e36900fbc5 |
| NEXT | package.json | 70032f9847594e0708215062d8224c2511f0c050394d45a2c61d8233bb50b1bb |
| NEXT | yarn.lock | ddb85b74ad5e406d6573773d4f515cb819993069b32a2ef827f1cb653014fe80 |
| NEXT | .yarnrc.yml | 710199cff64d30bb481bb0b8b9a6ad02f256af2c82f6f3a49c32beeb39c66211 |
| NEXT | .gitmodules | 59f250e0ebebd3dbea7ac5047a7faf2b5e407cf3f6e874801c1e871a170d40dc |
| NEXT | AGENTS.md | a8a85bab2c3b50b6a6d798646eba9a07490094bcba3a8b1cfbf67eda21f4d41d |
| NEXT | dsh-desktop-next/package.json | 8ff7f9bff2c95f13a3d320006b22a8f0006be1e01da8d7cf066e99a875ac79fb |
| NEXT | dsh-desktop-next/upstream-reference.json | 8bd3b613e8e19bc9612acca7c7d3db0641bb441370b036d3e4987406b734be70 |
| NEXT | dsh-desktop-next/cordis.patch.yml | 65a9b67897a5e077f3290849ef86436549e93059f438e94d28f36404ab42e478 |
| NEXT | dsh-desktop-next/host.cordis.patch.yml | b910ee95ab3ef0c199ff56cdeb8775423fa1177929b66c3e991225f86746bea0 |
| NEXT | dsh-desktop-next/src/extensions.ts | 5f25c6b8e2fd2a22a5e952e666e4b20ae2f37abd200a8e026fde82d1fe0aa7d9 |
| NEXT | dsh-desktop-next/src/browser-guests.ts | 049fbbd0b7e687ad6d678f36bd12ea9a4c1455eef76cab1c224845d0378e296b |
| NEXT | dsh-desktop-next/src/host-process.ts | 5895bf875f33a8d8b7bf18578c7d785a7dade59abd542a61bc3ac48c37df9c87 |
| NEXT | dsh-desktop-next/src/profiles.ts | 0b3b57c7b8daf56d4039f47bf0491eaefb9bb7af99740b7089e6e3069c85019e |
| NEXT | dsh-desktop-next/src/data-directory.ts | 450ef545f016e22c512b881015a9ac58f3ac09653faa0d149afd70ea9e7d2cdc |
| NEXT | dsh-desktop-next/src/node-environment.ts | cd760fede0ea4838269b09f9d68fd95dde2956d3542f16ed2a6b9629b02339bf |
| NEXT | scripts/prepare-dsh-market.mjs | a9744957715a935edc6c269836bf3b580638bd329584ad280370e2c1d99e5a01 |
| NEXT | scripts/prepare-agents-anywhere-release.mjs | 0b0e49d3703ed125436094e65298c8b1ab67b1844574d677192df1306fe0fa5c |

**源码树指纹**

| 树 | 文件数 | Git tree | 清单 SHA-256 |
| --- | --- | --- | --- |
| lib | 55 | 211921565770a9f706dc0ff3e07781a863bf559f | b0217def544766dd8ab3ace862174d70231b34673580d48ffa8c960cc00a6dad |
| src | 47 | bef26869bde9566cc178283caadde51a4f4edefe | d2e9d2439e9aca25d96d321a934a05473c992b37288373b48e83854557bb4f1c |
| client | 38 | 4cf22b23958546c1731193b9fd88e097549c13c9 | 967a36f0285d0805bfe5667604eece0795715dec3071faacea2d806c49e68d4e |
| skills | 3 | 451d18b6285e1ca6e9a705f22d3fe5c3a75dfc2b | 69a3a513e7e189ee8d56642f3c4298ea69b0b4f9eb44ac9456a12872e273d6b4 |
| vendor/nature-skills | 615 | 6d077c28f44151169ec80a80c025382233c29267 | 8b67bccbe7573104188459d52d392fbfcc4f94bc37d3a4cc6845f37a2f7cc946 |
| vendor/mnova-mcp | 23 | 96ae1bb53bedbba2b6687e1e252ea1301c5cbf09 | 4d0f8e8555003e330b20e17d2c2be83c8ab1650c7691c032c2f4cae1ef251dc8 |

这些是输入指纹，不是安装包、Python.exe、wheel 或运行时目录的制品校验值。不同工作区 CRLF/LF 不影响 Git blob 指纹。
Windows recipe 还固定 MarkItDown 0.1.7 及其格式依赖，并从已提交 Mnova 源码构建 wheel；recipe 与补丁均已入锁。
desktop/release-manifest 的 Python 字段仅为 3.12，精确版本以 runtime/versions.env 的 3.12.11 为准。

**P1 前置事项**

- 已有系统 Node 为 24.19.0，满足 NEXT 开发版本范围；其版本与旧捆绑 Node 24.16.0 分开记录。
- 已安装 Python 3.12 为 3.12.10，默认 python 为 3.11.9；均不作为 3.12.11 合格基底。P1 构建需取得并校验精确版本。
- 当前迁移分支尚未物化 node_modules、Python dist 与新的安装包。旧 Toolchain/windows-runtime-v0.4.2 及 Releases/v0.4.* 未批准复用。
- Python 依赖目前有版本 pin，离线 wheel/archive 内容 SHA-256 须在取得实际制品后冻结；P0 不声称已有离线资源。
- 根 NEXT build/dev/dist 会运行 market:prepare 或 aa:prepare-release。固定标签构建不得静默刷新 latest；
  P1 采用不刷新依赖的 workspace 构建路径，并在运行前审查该路径及固定安装锚点。
- 不改业务依赖到 rc.2、不执行补丁、不安装依赖、不启动图形程序、不运行迁移用户数据，以上属于后续阶段。
