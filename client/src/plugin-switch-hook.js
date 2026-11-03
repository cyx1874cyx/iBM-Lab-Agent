import { useEffect, useState } from "react";
import { subscribePluginSwitches } from "./plugin-switches.js";

/** 组件内订阅软开关；任何开关变化都会触发一次重渲染。 */
export function usePluginSwitches() {
	const [, bump] = useState(0);
	useEffect(() => subscribePluginSwitches(() => bump(value => value + 1)), []);
}
