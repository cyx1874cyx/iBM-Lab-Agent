import { currentDesktopSessionId } from './desktop-client.js';

export const isFileDrag = event => Array.from(event.dataTransfer?.types ?? []).includes('Files');

/** Use the host's attachment registry and input facade; never submit a turn. */
export function addConversationDrop(ctx, files) {
 const picked = Array.from(files ?? []);
 if (!picked.length) return;
 const sessionId = currentDesktopSessionId(ctx.sessions);
 const scope = sessionId && ctx.sessions.scope(sessionId);
 if (!scope) throw Error('当前对话尚未就绪，请稍后重试');
 const conversation = ctx.conversation, input = conversation.input.for(scope);
 const drafts = conversation.createDrafts(sessionId, picked);
 try {
  if (!input.addAttachments(drafts.map(draft => draft.id))) throw Error('当前对话正在提交，请稍后再添加文件');
 } catch (error) { conversation.releaseDraftAttachments(drafts); throw error; }
}
