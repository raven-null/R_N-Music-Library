// src/services/onlineMusic/netease/neteaseRuntime.ts
// 网易云在这个运行环境里到底能不能用：桌面版有内嵌后端，网页版必须有配置好的 API 地址。
// 单独放一个文件，是为了让 provider 的 getAvailability 不必去碰带网络请求的那套模块
// （测试里 mock 掉 netease.ts 时，这里仍然是真实实现）。

/** 桌面端：主进程开了内嵌后端，preload 暴露了问端口的方法。 */
const isDesktopRuntime = (): boolean => (
    typeof window !== 'undefined'
    && Boolean((window as { electron?: { getNeteasePort?: unknown } } | undefined)?.electron?.getNeteasePort)
);

/**
 * 没有 API 地址的网页构建里网易云整块用不了：平台按 `runtime-unavailable` 处理
 * （登录窗口不列出、账户也不去问，免得每次启动留一条 "who is signed in could not be asked"）。
 * 单元测试里没有部署配置，按可用处理，provider 的能力测试照常跑。
 */
export const isNeteaseApiUsable = (): boolean => {
    if (isDesktopRuntime()) return true;
    const env = (typeof import.meta !== 'undefined' ? (import.meta as { env?: Record<string, unknown> }).env : undefined) ?? {};
    if (env.MODE === 'test') return true;
    return typeof env.VITE_NETEASE_API_BASE === 'string' && env.VITE_NETEASE_API_BASE.length > 0;
};
