/**
 * dsh-lab-agent: CAS/SciFinder 安全边界（纯逻辑层）。
 *
 * 计划 §七（阶段六）：未获得额外书面授权前——
 *   - 不自动操作或读取 SciFinder 页面；
 *   - 不把 CAS 内容输入模型；
 *   - CAS 插件仅准备结构/查询并打开登录入口。
 * 获得明确 API 与 LLM 使用授权后，再启用独立 CAS Provider 与 OAuth2 PKCE
 * （本文件提供占位接口与授权门禁）。
 */

export const CAS_POLICY = Object.freeze({
	autoAccess: false,
	llmIngest: false,
	requiresWrittenAuthorization: true
});

export const SCIFINDER_LOGIN_URL = "https://scifinder-n.cas.org/";
export const COMMON_CHEMISTRY_SEARCH_URL = "https://commonchemistry.cas.org/results";
export const COMMON_CHEMISTRY_DETAIL_URL = "https://commonchemistry.cas.org/detail";

export class CasAuthorizationError extends Error {
	name = "CasAuthorizationError";
}

/**
 * CAS 授权门禁：所有 CAS Provider 操作前调用。
 * @param authorization 书面授权记录（如 {granted: true, grantRef}）；缺失/未授权即拒绝。
 */
export function assertCasAuthorized(authorization) {
	if (!authorization || authorization.granted !== true) {
		throw new CasAuthorizationError(
			"CAS/SciFinder access requires written authorization (API + LLM usage). " +
				"Until granted: no SciFinder page access, no CAS content into any model. " +
				"Use prepareCasQuery()/casLoginEntry() for structure/query preparation only."
		);
	}
	return authorization;
}

/**
 * 仅准备 CAS 查询（不执行请求、不读取页面）。
 * @param structure 结构（SMILES）或名称
 * @param casRn 可选 CAS Registry Number（如已知）
 * @returns 查询对象：Common Chemistry 搜索/详情 URL 与 SciFinder 登录入口。
 */
export function prepareCasQuery({ structure, name, casRn }) {
	const query = {
		kind: "prepared-query",
		scifinderLogin: SCIFINDER_LOGIN_URL,
		commonChemistry:
			casRn !== undefined
				? `${COMMON_CHEMISTRY_DETAIL_URL}?cas_rn=${encodeURIComponent(casRn)}`
				: `${COMMON_CHEMISTRY_SEARCH_URL}?q=${encodeURIComponent(name ?? structure ?? "")}`,
		input: { structure: structure ?? undefined, name: name ?? undefined, casRn: casRn ?? undefined },
		executed: false, // 本对象只准备，不发起任何请求
		policy: CAS_POLICY
	};
	return query;
}

/** 返回 SciFinder 登录入口（仅 URL；不自动打开/登录/操作）。 */
export function casLoginEntry() {
	return { url: SCIFINDER_LOGIN_URL, policy: CAS_POLICY, note: "login entry only; no automated access before written authorization" };
}

/**
 * CAS Provider 占位接口：授权后实现 OAuth2 PKCE + 独立查询；
 * 未授权时所有方法经 assertCasAuthorized 拒绝。
 */
export class CasProvider {
	constructor({ authorization } = {}) {
		this.authorization = authorization ?? null;
		this.oauth2Pkce = null; // 授权后配置：{ clientId, redirectUri, tokenEndpoint }
	}

	requireAuth() {
		return assertCasAuthorized(this.authorization);
	}

	/** 占位：授权后实现结构化检索（不把原始页面内容输入模型）。 */
	async search({ structure, name, casRn }) {
		this.requireAuth();
		// TODO(authorized): OAuth2 PKCE 流程 + CAS API 调用；结果只以结构化
		// 元数据（CAS RN、名称、来源）进入系统，原始页面内容不输入模型。
		throw new Error("CAS Provider is a placeholder; enable only after written authorization (API + LLM usage).");
	}

	/** 占位：OAuth2 PKCE 配置（授权后启用）。 */
	configureOauth2Pkce(config) {
		this.requireAuth();
		this.oauth2Pkce = { ...config };
		return this.oauth2Pkce;
	}
}
