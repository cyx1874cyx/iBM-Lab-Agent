import {useRef,useState} from 'react';
import {h} from 'dsh-lab-agent/client-sdk';
import {ConversationSvg} from './reading-action-icons.js';

export const readingConversationId=(report,bundle={})=>bundle.conversationSessionId||report.sessionId||bundle.pdfIntake?.sessionId||[...(bundle.translations||[])].reverse().find(row=>row.sessionId)?.sessionId;

export function EntryConversationButton({sessionId,onOpen,notify}){
 const [busy,setBusy]=useState(false),lock=useRef(false);
 const open=async event=>{
  event.stopPropagation();if(lock.current||!sessionId||!onOpen)return;
  lock.current=true;setBusy(true);
  try{await onOpen(sessionId);}catch(error){notify?.(error.message);}finally{lock.current=false;setBusy(false);}
 };
 return h('button',{className:'ib-icon-btn','data-kind':'conversation','data-ready':sessionId?'true':'false','aria-label':'打开科研助手对话','aria-busy':busy,disabled:busy||!sessionId||!onOpen,title:!sessionId?'此条目尚未绑定科研助手对话':busy?'正在打开对话…':'打开此条目绑定的科研助手对话',onClick:open},h(ConversationSvg,null));
}
