package com.devstudio.kanban.common;

import java.net.InetAddress;
import java.net.URI;
import java.net.UnknownHostException;

/**
 * 推送 webhook 地址安全校验：仅允许 http/https，且主机不得解析到本机/内网/链路本地等地址，
 * 防止空间成员把"服务端会带密钥访问的地址"指向内部网络（SSRF）。
 */
public final class Webhooks {

    private Webhooks() {
    }

    /** 校验通过返回 null，否则返回中文错误说明；空值视为未配置（通过） */
    public static String check(String raw) {
        String url = Texts.trimToNull(raw);
        if (url == null) {
            return null;
        }
        URI uri;
        try {
            uri = new URI(url);
        } catch (Exception e) {
            return "推送地址格式不正确";
        }
        String scheme = uri.getScheme() == null ? "" : uri.getScheme().toLowerCase();
        if (!"http".equals(scheme) && !"https".equals(scheme)) {
            return "推送地址必须以 http:// 或 https:// 开头";
        }
        String host = uri.getHost();
        if (host == null || host.isEmpty()) {
            return "推送地址缺少主机名";
        }
        InetAddress[] addrs;
        try {
            addrs = InetAddress.getAllByName(host);
        } catch (UnknownHostException e) {
            return "推送地址无法解析：" + host;
        }
        for (InetAddress addr : addrs) {
            if (isBlocked(addr)) {
                return "推送地址不能指向本机或内网地址：" + host;
            }
        }
        return null;
    }

    private static boolean isBlocked(InetAddress addr) {
        if (addr.isLoopbackAddress() || addr.isSiteLocalAddress() || addr.isLinkLocalAddress()
                || addr.isAnyLocalAddress() || addr.isMulticastAddress()) {
            return true;
        }
        byte[] b = addr.getAddress();
        if (b.length == 16) {
            // IPv6 唯一本地地址 fc00::/7
            return (b[0] & 0xFE) == 0xFC;
        }
        int first = b[0] & 0xFF;
        int second = b[1] & 0xFF;
        // 100.64.0.0/10（运营商级 NAT）、198.18.0.0/15（基准测试）、192.0.0.0/24（IETF 保留）
        if (first == 100 && second >= 64 && second <= 127) {
            return true;
        }
        if (first == 198 && (second == 18 || second == 19)) {
            return true;
        }
        return first == 192 && second == 0 && (b[2] & 0xFF) == 0;
    }
}
