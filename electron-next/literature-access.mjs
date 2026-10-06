/** Page evidence only: a visible abstract or PDF link does not prove entitlement. */
export function classifyLiteratureAccess({text='',title='',statusCode=0,documentType='',password=false,fullText=false,downloadEntry=false}={}) {
 const content=(title+'\n'+text).slice(0,60000);
 const verdict=(state,evidence)=>({state,evidence,checkedAt:new Date().toISOString()});
 if(/verify (?:you are|that you are) human|checking your browser|security check|captcha|人机验证|安全验证|just a moment/i.test(content))return verdict('verification-required','页面要求人机或安全验证');
 if(password||/^(?:sign in|log in|登录|统一身份认证)$/i.test(title.trim()))return verdict('login-required','当前页面要求登录');
 if(statusCode===404||statusCode===410||/article (?:not found|has been removed)|page not found|页面不存在|文章不存在/i.test(content))return verdict('not-found','文章页面不存在或已移除');
 if(statusCode===401)return verdict('login-required','页面返回 HTTP 401');
 if(statusCode===403||/you (?:do not|don.t) have access|you have no access|access to this (?:article|content) is (?:restricted|denied)|access denied|purchase this article|subscribe to (?:read|access) (?:the |this )?(?:full |article|content)|buy (?:this )?article|this is a preview of subscription content|您暂无访问权限|您没有访问权限|购买此文章|订阅后阅读/i.test(content))return verdict('access-denied',statusCode===403?'页面返回 HTTP 403':'页面明确提示无权限、购买或订阅');
 if(statusCode>=400)return verdict('page-error','页面返回 HTTP '+statusCode);
 if(/^application\/pdf(?:;|$)/i.test(documentType)||fullText)return verdict('accessible',/^application\/pdf/i.test(documentType)?'浏览器收到 PDF 文档响应':'页面包含可见正文内容');
 return verdict('unknown',downloadEntry?'发现下载入口，正文权限仍待确认':'未发现足以确认正文访问权限的证据');
}

export function accessView(access) {
 const views={
  'access-denied':['access-denied','当前页面明确提示文献不可访问；本次获取已停止。请检查机构权限，或上传合法取得的 PDF。','check-institution-access'],
  'not-found':['not-found','出版社文章页面不存在或已移除；请核对 DOI 或文章链接。','check-paper-link'],
  'page-error':['page-error','出版社页面返回错误；请稍后重试。','retry-later'],
  'login-required':['waiting-login','页面已打开，需要机构登录；请在侧栏完成登录，再重新观察页面。','complete-login'],
  'verification-required':['waiting-verification','页面已打开，需要人机验证；请在侧栏完成验证，再重新观察页面。','complete-verification']
 };
 const value=views[access?.state];return value?{phase:value[0],message:value[1],nextAction:value[2],requiresUserAction:true}:null;
}
