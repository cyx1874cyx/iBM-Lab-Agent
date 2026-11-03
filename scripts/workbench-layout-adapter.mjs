/** Add one opt-in layout composition seat; the upstream default remains its fallback.
 * The layout owner delegates its authorized renderSlot to the iBM surface.
 * Never redeclare or steal the host's existing sidebar/main/rightbar slots.
 */
export function adaptWorkbenchLayout(source) {
 if (source.includes('function IbmWorkbenchFrame(')) return source;
 const replaceOnce = (input, from, to) => {
  if (input.split(from).length !== 2) throw Error('Unsupported layout runtime: expected exactly one ' + from.slice(0, 70));
  return input.replace(from, to);
 };
 let result = replaceOnce(source, 'function AppFrame({', 'function AppFrameDefault({');
 result = replaceOnce(result, 'function apply(ctx) {', `function IbmWorkbenchFrame(props) {
 return props.renderSlot('lab.workbench', {frame: {renderSlot: props.renderSlot, usePanelInfo: props.usePanelInfo}}, {fallback: react.createElement(AppFrameDefault, props)});
}
function apply(ctx) {`);
 result = replaceOnce(result, '}, AppFrame);', '}, IbmWorkbenchFrame);');
 result = replaceOnce(result, '"sidebar": {', '"lab.workbench": {kind: "single", scope: "root"},\n"sidebar": {');
 return result;
}
