/**
 * 文献数据源目录与状态模型。
 *
 * 数据源分成两类：公开 API 直接做轻量探测；订阅/校内资源通过用户本人登录的
 * 持久化浏览器配置访问。应用不读取或导出 Cookie，只复用浏览器保存的会话。
 */

import { z } from "zod";

export const CAPABILITY_STATES = [
	"available",
	"connected",
	"degraded",
	"auth-required",
	"waiting-user",
	"verification-required",
	"unavailable",
	"not-supported",
	"unknown"
];

export const CONNECTION_STATES = [
	"idle",
	"browser-open",
	"waiting-user",
	"agreement-required",
	"connected",
	"verification-required",
	"expired",
	"error"
];

export const DOWNLOAD_STATES = [
	"queued",
	"resolving-oa",
	"waiting-login",
	"opening-publisher",
	"locating-pdf",
	"downloading",
	"completed",
	"no-access",
	"verification-required",
	"failed"
];

const capabilitySchema = z.object({
	state: z.enum(CAPABILITY_STATES),
	message: z.string(),
	checkedAt: z.string(),
	latencyMs: z.number().nonnegative().optional(),
	httpStatus: z.number().int().optional()
});

export const literatureSourceStatusSchema = z.object({
	id: z.string(),
	name: z.string(),
	tier: z.string(),
	authMode: z.enum(["public", "api-key", "institutional"]),
	search: capabilitySchema,
	download: capabilitySchema,
	connection: z.object({
		state: z.enum(CONNECTION_STATES),
		message: z.string(),
		lastOpenedAt: z.string().optional(),
		lastVerifiedAt: z.string().optional()
	}),
	entryUrl: z.string().url().optional(),
	institutionEntryUrl: z.string().url().optional(),
	supportsDownload: z.boolean().optional(),
	restrictedAutomation: z.boolean().optional()
});

export const literatureSessionSchema = z.object({
	id: z.string(),
	sourceId: z.string(),
	state: z.enum(CONNECTION_STATES).default("idle"),
	resourceUrl: z.string().url().optional(),
	browser: z.string().optional(),
	debuggingPort: z.number().int().min(1024).max(65535).optional(),
	lastOpenedAt: z.string().optional(),
	lastVerifiedAt: z.string().optional(),
	lastError: z.string().optional(),
	createdAt: z.string(),
	updatedAt: z.string()
});

export const literatureDownloadSchema = z.object({
	id: z.string(),
	identifier: z.string(),
	doi: z.string().optional(),
	sourceId: z.string().optional(),
	state: z.enum(DOWNLOAD_STATES),
	message: z.string(),
	route: z.enum(["open-access", "institutional-browser"]).optional(),
	title: z.string().optional(),
	landingUrl: z.string().url().optional(),
	filePath: z.string().optional(),
	fileName: z.string().optional(),
	byteLength: z.number().int().nonnegative().optional(),
	sha256: z.string().regex(/^[a-f0-9]{64}$/).optional(),
	pageEstimate: z.number().int().positive().optional(),
	createdAt: z.string(),
	updatedAt: z.string(),
	completedAt: z.string().optional()
});

/**
 * 探测 URL 必须小而稳定；只验证入口/接口是否可达，不批量抓取结果。
 * 订阅数据库的真实权限最终以持久化浏览器会话中的检索和全文页面为准。
 */
export const LITERATURE_SOURCES = Object.freeze([
	{
		id: "openalex", name: "OpenAlex", tier: "T1 · 开放索引", authMode: "public",
		description: "Nature Skill 无 MCP 时的跨学科检索后备源。",
		entryUrl: "https://openalex.org/",
		expectedHosts: ["openalex.org"],
		searchProbe: "https://api.openalex.org/works?search=polymer&per-page=1",
		downloadProbe: null,
		supportsDownload: false
	},
	{
		id: "pubmed", name: "PubMed", tier: "T1 · 官方 API", authMode: "public",
		description: "生命科学与医学文献，检索可直接验证；全文下载取决于 PMC/OA。",
		entryUrl: "https://pubmed.ncbi.nlm.nih.gov/",
		expectedHosts: ["pubmed.ncbi.nlm.nih.gov", "ncbi.nlm.nih.gov"],
		searchProbe: "https://eutils.ncbi.nlm.nih.gov/entrez/eutils/esearch.fcgi?db=pubmed&term=polymer&retmax=0&retmode=json",
		downloadProbe: null,
		supportsDownload: true
	},
	{
		id: "crossref", name: "Crossref", tier: "T1 · 官方 API", authMode: "public",
		description: "跨学科 DOI 与引文元数据；全文由 DOI 落地页或校内资源解析。",
		entryUrl: "https://search.crossref.org/",
		expectedHosts: ["crossref.org", "doi.org"],
		searchProbe: "https://api.crossref.org/works?query=polymer&rows=1",
		downloadProbe: null,
		supportsDownload: false
	},
	{
		id: "arxiv", name: "arXiv", tier: "T1 · 官方 API", authMode: "public",
		description: "物理、数学、计算机与相关预印本，可直接下载开放 PDF。",
		entryUrl: "https://arxiv.org/",
		expectedHosts: ["arxiv.org", "export.arxiv.org"],
		searchProbe: "https://export.arxiv.org/api/query?search_query=all:polymer&start=0&max_results=1",
		downloadProbe: "https://arxiv.org/pdf/1706.03762",
		supportsDownload: true
	},
	{
		id: "scopus", name: "Scopus", tier: "T3 · 机构订阅", authMode: "institutional",
		description: "引文索引；优先通过学校图书馆、CARSI 或机构代理登录。",
		entryUrl: "https://www.scopus.com/",
		expectedHosts: ["scopus.com", "elsevier.com"],
		loginHosts: ["id.elsevier.com", "carsi.edu.cn"],
		searchProbe: "https://www.scopus.com/",
		downloadProbe: null,
		supportsDownload: false
	},
	{
		id: "engineering-village", name: "Ei Compendex", tier: "工程索引 · 机构订阅", authMode: "institutional",
		description: "Engineering Village 上的工程文献索引；中科大图书馆常用入口。",
		entryUrl: "https://www.engineeringvillage.com/",
		expectedHosts: ["engineeringvillage.com"],
		loginHosts: ["id.elsevier.com", "carsi.edu.cn", "passport.ustc.edu.cn", "authserver"],
		searchProbe: "https://www.engineeringvillage.com/",
		downloadProbe: null,
		supportsDownload: false
	},
	{
		id: "scifinder", name: "SciFinder", tier: "CAS · 受限机构资源", authMode: "institutional",
		description: "仅验证入口和人工登录状态；未获额外 CAS 授权前不自动检索、抓取或向模型传输内容。",
		entryUrl: "https://scifinder-n.cas.org/",
		expectedHosts: ["scifinder-n.cas.org", "cas.org"],
		loginHosts: ["accounts.cas.org", "carsi.edu.cn", "passport.ustc.edu.cn", "authserver"],
		searchProbe: "https://scifinder-n.cas.org/",
		downloadProbe: null,
		supportsDownload: false,
		restrictedAutomation: true
	},
	{
		id: "reaxys", name: "Reaxys", tier: "化学数据库 · 机构订阅", authMode: "institutional",
		description: "化学物质、反应与文献索引；通过中科大机构权限进入。",
		entryUrl: "https://www.reaxys.com/",
		expectedHosts: ["reaxys.com"],
		loginHosts: ["id.elsevier.com", "carsi.edu.cn", "passport.ustc.edu.cn", "authserver"],
		searchProbe: "https://www.reaxys.com/",
		downloadProbe: null,
		supportsDownload: false
	},
	{
		id: "ieee-xplore", name: "IEEE Xplore", tier: "工程全文库 · 机构订阅", authMode: "institutional",
		description: "IEEE/IET 期刊、会议与标准；按中科大订阅权限验证 PDF。",
		entryUrl: "https://ieeexplore.ieee.org/Xplore/home.jsp",
		expectedHosts: ["ieeexplore.ieee.org", "ieee.org"],
		loginHosts: ["carsi.edu.cn", "passport.ustc.edu.cn", "authserver", "shibboleth"],
		searchProbe: "https://ieeexplore.ieee.org/Xplore/home.jsp",
		downloadProbe: null,
		supportsDownload: true
	},
	{
		id: "nature-portfolio", name: "Nature Portfolio", tier: "出版商全文 · 机构订阅", authMode: "institutional",
		description: "Nature 及系列期刊；优先开放获取，否则按中科大订阅验证全文。",
		entryUrl: "https://www.nature.com/",
		institutionEntryUrl: "https://sp.nature.com/saml/login?idp=https%3A%2F%2Fidp.ustc.edu.cn%2Fidp%2Fshibboleth&targetUrl=https%3A%2F%2Fwww.nature.com%2Fnature",
		expectedHosts: ["nature.com", "springernature.com"],
		loginHosts: ["carsi.edu.cn", "passport.ustc.edu.cn", "authserver", "shibboleth"],
		searchProbe: "https://www.nature.com/",
		downloadProbe: null,
		supportsDownload: true
	},
	{
		id: "acs", name: "ACS Publications", tier: "化学全文库 · 机构订阅", authMode: "institutional",
		description: "ACS 期刊与补充材料；按中科大订阅权限验证主文 PDF。",
		entryUrl: "https://pubs.acs.org/",
		institutionEntryUrl: "https://pubs.acs.org/action/ssostart?idp=https%3A%2F%2Fidp.ustc.edu.cn%2Fidp%2Fshibboleth&redirectUri=%2Faction%2Fssostart",
		expectedHosts: ["pubs.acs.org", "acs.org"],
		loginHosts: ["carsi.edu.cn", "passport.ustc.edu.cn", "authserver", "shibboleth"],
		searchProbe: "https://pubs.acs.org/",
		downloadProbe: null,
		supportsDownload: true
	},
	{
		id: "sciencedirect", name: "ScienceDirect", tier: "订阅全文库", authMode: "institutional",
		description: "Elsevier 文献检索与全文；下载权限按学校订阅范围验证。",
		entryUrl: "https://www.sciencedirect.com/",
		institutionEntryUrl: "https://auth.elsevier.com/ShibAuth/institutionLogin?appReturnURL=https%3A%2F%2Fwww.sciencedirect.com%2Fuser%2Frouter%2Fshib%3FtargetURL%3Dhttps%253A%252F%252Fwww.sciencedirect.com%252F&entityID=https%3A%2F%2Fidp.ustc.edu.cn%2Fidp%2Fshibboleth",
		expectedHosts: ["sciencedirect.com", "elsevier.com"],
		loginHosts: ["id.elsevier.com", "carsi.edu.cn"],
		searchProbe: "https://www.sciencedirect.com/",
		downloadProbe: "https://www.sciencedirect.com/",
		supportsDownload: true
	},
	{
		id: "web-of-science", name: "Web of Science (SCI)", tier: "T3 · 机构订阅", authMode: "institutional",
		description: "中科大已验证：核心合集与 SCI-EXPANDED 可用；同时作为校内全文路由入口。",
		entryUrl: "https://www.webofscience.com/?DestApp=WOS&editions=SCI",
		institutionEntryUrl: "https://www.webofknowledge.com/?DestApp=UA&ShibFederation=ChineseFederation&auth=ShibbolethIdPForm&entityID=https%3A%2F%2Fidp.ustc.edu.cn%2Fidp%2Fshibboleth&target=https%253A%252F%252Fwww.webofknowledge.com%252F%253FDestApp%253DUA",
		expectedHosts: ["webofscience.com", "webofknowledge.com", "clarivate.com", "clarivate.cn"],
		loginHosts: ["carsi.edu.cn", "passport.ustc.edu.cn", "shibboleth", "authserver"],
		searchProbe: "https://www.webofscience.com/",
		downloadProbe: null,
		supportsDownload: false
	},
	{
		id: "cnki", name: "中国知网 CNKI", tier: "中文库 · 机构订阅", authMode: "institutional",
		description: "中文期刊、学位与会议文献；检索和下载以学校授权为准。",
		entryUrl: "https://www.cnki.net/",
		expectedHosts: ["cnki.net", "cnki.com.cn"],
		loginHosts: ["login.cnki.net", "carsi.edu.cn", "authserver"],
		searchProbe: "https://www.cnki.net/",
		downloadProbe: null,
		supportsDownload: true
	},
	{
		id: "wanfang", name: "万方数据", tier: "中文库 · 机构订阅", authMode: "institutional",
		description: "中文期刊、学位、会议与标准资源；按机构权限下载。",
		entryUrl: "https://www.wanfangdata.com.cn/",
		expectedHosts: ["wanfangdata.com.cn"],
		loginHosts: ["login.wanfangdata.com.cn", "carsi.edu.cn", "authserver"],
		searchProbe: "https://www.wanfangdata.com.cn/",
		downloadProbe: null,
		supportsDownload: true
	},
	{
		id: "institution-library", name: "中国科大图书馆入口", tier: "USTC 统一身份认证", authMode: "institutional",
		description: "中科大电子资源主入口；校外可经学校身份认证和协议确认后进入数据库。",
		entryUrl: "https://lib.ustc.edu.cn/",
		expectedHosts: ["lib.ustc.edu.cn"],
		loginHosts: ["passport.ustc.edu.cn", "carsi.edu.cn", "authserver", "shibboleth", "webvpn", "ezproxy", "iwang.ustc.edu.cn"],
		searchProbe: "https://lib.ustc.edu.cn/",
		downloadProbe: null,
		supportsDownload: true,
		configurable: true
	}
]);

export function getLiteratureSource(id) {
	return LITERATURE_SOURCES.find((source) => source.id === id);
}

export function requireLiteratureSource(id) {
	const source = getLiteratureSource(id);
	if (source === undefined) throw new Error(`unknown literature source '${id}'`);
	return source;
}

export function normalizeResourceUrl(value) {
	let parsed = new URL(String(value ?? "").trim());
	if (parsed.protocol !== "https:" && parsed.protocol !== "http:") {
		throw new Error("数据库入口只支持 http/https 地址");
	}
	// CAS/SSO 登录 URL 应保存回调资源入口，不保存一次性认证参数。
	const service = parsed.searchParams.get("service") ?? parsed.searchParams.get("redirect_uri");
	if (/authserver|\/cas\/login|\/sso\/login/i.test(`${parsed.hostname}${parsed.pathname}`) && service) {
		try {
			const callback = new URL(service);
			if (callback.protocol === "https:" || callback.protocol === "http:") parsed = callback;
		} catch { /* 保留原入口，再由下方删除敏感参数。 */ }
	}
	parsed.username = "";
	parsed.password = "";
	for (const key of [...parsed.searchParams.keys()]) {
		if (/^(ticket|code|token|access_token|id_token|session|state|samlrequest|samlresponse|relaystate|jsessionid)$/i.test(key)) {
			parsed.searchParams.delete(key);
		}
	}
	return parsed.href;
}

export function sourcePublicView(source, session) {
	return {
		id: source.id,
		name: source.name,
		tier: source.tier,
		authMode: source.authMode,
		description: source.description,
		entryUrl: session?.resourceUrl ?? source.entryUrl,
		institutionEntryUrl: source.institutionEntryUrl,
		configurable: source.configurable === true,
		supportsDownload: source.supportsDownload,
		restrictedAutomation: source.restrictedAutomation === true
	};
}
