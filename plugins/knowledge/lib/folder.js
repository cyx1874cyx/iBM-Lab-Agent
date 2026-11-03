/**
 * 精读文件夹名校验（插件内副本）。
 *
 * 与母包 `lib/tasks/organization.js` 的 validateReadingFolderName 逐字等价；
 * 有 parity 测试兜底。知识库只校验用户输入，真正的文件夹由文献插件创建。
 */
export const validateReadingFolderName = value => {
	const name = String(value ?? "").replace(/\s+/g, " ").trim();
	if (!name || name.length > 80 || /[\x00-\x1f\\/]/.test(name) || ["全部", "未分类"].includes(name)) {
		throw Error("文件夹名称需为 1–80 字，不含斜杠，且不能使用“全部”或“未分类”");
	}
	return name;
};
