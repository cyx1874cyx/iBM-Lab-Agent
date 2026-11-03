import {h} from 'dsh-lab-agent/client-sdk';

const icon=(...children)=>h('svg',{width:16,height:16,viewBox:'0 0 24 24',fill:'none',stroke:'currentColor',strokeWidth:1.7,strokeLinecap:'round',strokeLinejoin:'round','aria-hidden':true},...children);
export const OverviewSvg=()=>icon(h('circle',{cx:12,cy:12,r:9}),h('path',{d:'M12 11v6M12 7h.01'}));
export const TranslateSvg=()=>icon(h('path',{d:'M2 5h12M7 2h1M5 8l6 6M4 14l6-6 2-3M12 22l5-10 5 10M14 18h6'}));
export const ReadingNoteSvg=()=>icon(h('path',{d:'M14 3H5a2 2 0 0 0-2 2v14a2 2 0 0 0 2 2h14a2 2 0 0 0 2-2v-9M7 7h4M7 11h2M7 15h2M13 15l1-4 6-6a1.4 1.4 0 0 1 2 2l-6 6-3 2ZM18 7l2 2'}));
export const PresentationSvg=()=>icon(h('path',{d:'M3 3h18M4 3v12h16V3M12 15v6M8 21l4-3 4 3M8 11V8M12 11V6M16 11V9'}));
export const ConversationSvg=()=>icon(h('path',{d:'M21 11.5a8.5 8.5 0 0 1-8.5 8.5H4l-3 2 2-6a8.5 8.5 0 1 1 18-4.5ZM7 10h9M7 14h6'}));
