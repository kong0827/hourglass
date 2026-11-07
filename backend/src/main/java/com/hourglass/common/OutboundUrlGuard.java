package com.hourglass.common;

import java.net.InetAddress;
import java.net.URI;
import java.net.UnknownHostException;

/**
 * 服务端出站地址校验：阻止用户自定义 AI 地址访问回环、内网、链路本地和云元数据地址。
 *
 * <p>本地 Ollama/局域网中转可以通过 {@code app.ai.allow-private-network=true} 显式放开；
 * 默认关闭，避免任意登录用户把服务端当内网探测代理。重定向已在出站连接池关闭，
 * 这里再在请求前做一次解析校验，降低 DNS 变更后的绕过风险。</p>
 */
public final class OutboundUrlGuard {

    private OutboundUrlGuard() {
    }

    public static void validate(String rawUrl, boolean allowPrivateNetwork) {
        if (rawUrl == null || rawUrl.trim().isEmpty()) {
            throw new IllegalArgumentException("接口地址不能为空");
        }
        URI uri;
        try {
            uri = URI.create(rawUrl.trim());
        } catch (IllegalArgumentException e) {
            throw new IllegalArgumentException("接口地址格式不正确");
        }
        String scheme = uri.getScheme();
        if (!"http".equalsIgnoreCase(scheme) && !"https".equalsIgnoreCase(scheme)) {
            throw new IllegalArgumentException("接口地址必须以 http:// 或 https:// 开头");
        }
        if (uri.getUserInfo() != null) {
            throw new IllegalArgumentException("接口地址不能包含用户名或密码");
        }
        String host = uri.getHost();
        if (host == null || host.isEmpty()) {
            throw new IllegalArgumentException("接口地址缺少主机名");
        }
        InetAddress[] addresses;
        try {
            addresses = InetAddress.getAllByName(host);
        } catch (UnknownHostException e) {
            throw new IllegalArgumentException("接口地址无法解析：" + host);
        }
        if (addresses.length == 0) {
            throw new IllegalArgumentException("接口地址无法解析：" + host);
        }
        if (allowPrivateNetwork) {
            return;
        }
        for (InetAddress address : addresses) {
            if (isBlocked(address)) {
                throw new IllegalArgumentException("接口地址不能指向内网或本机：" + host);
            }
        }
    }

    private static boolean isBlocked(InetAddress address) {
        if (address.isAnyLocalAddress() || address.isLoopbackAddress()
                || address.isLinkLocalAddress() || address.isSiteLocalAddress()
                || address.isMulticastAddress()) {
            return true;
        }
        byte[] bytes = address.getAddress();
        if (bytes.length == 4) {
            int first = bytes[0] & 0xff;
            int second = bytes[1] & 0xff;
            /* 100.64.0.0/10 运营商级 NAT；0.0.0.0/8；169.254/16 已由 link-local 覆盖 */
            if (first == 0 || (first == 100 && second >= 64 && second <= 127)) {
                return true;
            }
            return false;
        }
        if (bytes.length == 16) {
            int first = bytes[0] & 0xff;
            /* fc00::/7 IPv6 唯一本地地址 */
            return (first & 0xfe) == 0xfc;
        }
        return true;
    }
}
