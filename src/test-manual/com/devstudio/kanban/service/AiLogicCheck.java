package com.devstudio.kanban.service;

import com.devstudio.kanban.common.AiClient;
import com.devstudio.kanban.common.AiCrypto;
import com.devstudio.kanban.common.AiProviders;
import com.fasterxml.jackson.databind.JsonNode;
import com.fasterxml.jackson.databind.ObjectMapper;

/**
 * AI 相关纯逻辑的临时校验（项目没有测试框架，用 javac 手跑）。
 * 覆盖：富文本转文本 / 优先级与状态归一 / 覆盖率与结论推导 / JSON 宽容解析 / key 加解密 / 地址拼接 / 错误翻译。
 */
public class AiLogicCheck {

    private static int pass = 0;
    private static int fail = 0;
    private static final ObjectMapper OM = new ObjectMapper();

    public static void main(String[] args) {
        System.out.println("— 富文本转纯文本 —");
        String html = "<h2>接口</h2><p>出金接口要幂等。</p>"
                + "<ul><li>按流水号去重</li><li>失败重试 3 次</li></ul>"
                + "<table><tr><th>字段</th><th>说明</th></tr><tr><td>fundId</td><td>资金账户</td></tr></table>";
        String text = AiReqDocService.htmlToText(html);
        ok("标题保留为 ## 行", text.contains("## 接口"));
        ok("段落保留换行", text.contains("\n出金接口要幂等"));
        ok("列表项带 - 前缀", text.contains("- 按流水号去重"));
        ok("表格行保留单元格边界", text.contains("fundId | 资金账户"));
        ok("没有连续三个以上的空行", !text.contains("\n\n\n"));
        eq("空正文返回空串", "", AiReqDocService.htmlToText(null));
        eq("空白正文返回空串", "", AiReqDocService.htmlToText("   "));

        System.out.println("— 优先级归一 —");
        eq("P0 保持", "P0", AiReqDocService.normalizePriority("P0"));
        eq("小写 p1 转大写", "P1", AiReqDocService.normalizePriority("p1"));
        eq("high 视为 P0", "P0", AiReqDocService.normalizePriority("high"));
        eq("紧急 视为 P0", "P0", AiReqDocService.normalizePriority("紧急"));
        eq("中 视为 P2", "P2", AiReqDocService.normalizePriority("中"));
        eq("low 视为 P3", "P3", AiReqDocService.normalizePriority("low"));
        eq("非法值兜底 P2", "P2", AiReqDocService.normalizePriority("P9"));
        eq("空值兜底 P2", "P2", AiReqDocService.normalizePriority(null));

        System.out.println("— 状态归一 —");
        eq("done", "done", AiReqDocService.normalizeStatus("done", true));
        eq("已完成 → done", "done", AiReqDocService.normalizeStatus("已完成", true));
        eq("进行中 → doing", "doing", AiReqDocService.normalizeStatus("进行中", true));
        eq("in_progress → doing", "doing", AiReqDocService.normalizeStatus("in_progress", true));
        eq("未开始 → todo", "todo", AiReqDocService.normalizeStatus("未开始", false));
        eq("缺失 → missing", "missing", AiReqDocService.normalizeStatus("缺失", false));
        eq("没给状态但有覆盖 → done", "done", AiReqDocService.normalizeStatus(null, true));
        eq("没给状态且无覆盖 → missing", "missing", AiReqDocService.normalizeStatus("", false));

        System.out.println("— 结论推导（程序算，不信模型） —");
        eq("高分且无缺失 → done", "done", AiReqDocService.verdictOf(96, 0, 10));
        eq("高分但有缺失 → 不能是 done", "mostly", AiReqDocService.verdictOf(96, 1, 10));
        eq("70 分 → mostly", "mostly", AiReqDocService.verdictOf(70, 2, 10));
        eq("40 分 → partial", "partial", AiReqDocService.verdictOf(40, 3, 10));
        eq("10 分 → not_started", "not_started", AiReqDocService.verdictOf(10, 5, 10));
        eq("没有功能点 → not_started", "not_started", AiReqDocService.verdictOf(0, 0, 0));

        System.out.println("— AI 返回 JSON 的宽容解析 —");
        JsonNode n1 = aiJson("{\"tasks\":[{\"title\":\"a\"}]}");
        eq("纯 JSON", "a", n1.path("tasks").path(0).path("title").asText());
        JsonNode n2 = aiJson("```json\n{\"tasks\":[]}\n```");
        ok("剥掉 ```json 围栏", n2.path("tasks").isArray());
        JsonNode n3 = aiJson("好的，结果如下：\n{\"coverage\":88}\n以上。");
        eq("前后有解释文字也能抽出来", 88, n3.path("coverage").asInt());
        try {
            aiJson("这不是 JSON");
            fail++;
            System.out.println("  FAIL 非法内容应该抛错");
        } catch (IllegalStateException e) {
            pass++;
            System.out.println("  ok   非法内容抛错且带片段提示 => " + e.getMessage());
        }

        System.out.println("— Key 加解密 —");
        AiCrypto crypto = new AiCrypto("unit-test-secret");
        String cipher = crypto.encrypt("sk-1234567890abcdef");
        ok("密文带 v1: 前缀", cipher != null && cipher.startsWith("v1:"));
        ok("密文里看不到明文", cipher != null && !cipher.contains("1234567890"));
        eq("能解回原文", "sk-1234567890abcdef", crypto.decrypt(cipher));
        ok("同一明文两次加密结果不同（IV 随机）", !cipher.equals(crypto.encrypt("sk-1234567890abcdef")));
        eq("明文（历史数据）原样返回", "legacy-key", crypto.decrypt("legacy-key"));
        eq("换密钥后解不开返回 null", null, new AiCrypto("another-secret").decrypt(cipher));
        eq("空值返回 null", null, crypto.decrypt(null));
        eq("短 key 全遮", "****", AiCrypto.mask("abc123"));
        eq("长 key 只露头尾", "sk-****cdef", AiCrypto.mask("sk-1234567890abcdef"));
        eq("空 key 掩码为 null", null, AiCrypto.mask(""));

        System.out.println("— 接口地址拼接 —");
        eq("补 /chat/completions", "https://api.deepseek.com/v1/chat/completions",
                AiClient.endpoint("https://api.deepseek.com/v1"));
        eq("去掉尾部斜杠", "https://x.com/v1/chat/completions", AiClient.endpoint("https://x.com/v1/"));
        eq("已经是完整地址就不重复拼", "https://x.com/v1/chat/completions",
                AiClient.endpoint("https://x.com/v1/chat/completions"));
        eq("只有域名也补全", "http://127.0.0.1:11434/v1/chat/completions",
                AiClient.endpoint("http://127.0.0.1:11434/v1"));

        System.out.println("— 上游错误翻译 —");
        eq("取 error.message", "Invalid API key",
                AiClient.upstreamMessage("{\"error\":{\"message\":\"Invalid API key\"}}"));
        eq("取顶层 message", "quota exceeded",
                AiClient.upstreamMessage("{\"message\":\"quota exceeded\"}"));
        ok("非 JSON 时截断原文", AiClient.upstreamMessage("<html>502</html>").contains("502"));

        System.out.println("— 厂商预置 —");
        ok("预置 8 家", AiProviders.all().size() == 8);
        eq("deepseek 默认模型", "deepseek-chat", AiProviders.modelOr("deepseek", null));
        eq("自定义地址优先于预置", "https://proxy.local/v1",
                AiProviders.baseUrlOr("deepseek", "https://proxy.local/v1"));
        eq("没配厂商时返回 null", null, AiProviders.modelOr(null, null));
        ok("ollama 不需要 key 也算可用", ollamaUsable());

        System.out.println();
        System.out.println("==== 通过 " + pass + " / 失败 " + fail + " ====");
        if (fail > 0) {
            System.exit(1);
        }
    }

    private static boolean ollamaUsable() {
        com.devstudio.kanban.dto.AiConfig c = new com.devstudio.kanban.dto.AiConfig();
        c.setProvider("ollama");
        c.setBaseUrl("http://127.0.0.1:11434/v1");
        c.setModel("qwen2.5:7b");
        return c.usable();
    }

    private static JsonNode aiJson(String content) {
        return AiClient.extractJson(OM, content);
    }

    private static void eq(String name, Object expect, Object actual) {
        boolean same = expect == null ? actual == null : expect.equals(actual);
        if (same) {
            pass++;
            System.out.println("  ok   " + name + " = " + actual);
        } else {
            fail++;
            System.out.println("  FAIL " + name + " 期望 [" + expect + "] 实际 [" + actual + "]");
        }
    }

    private static void ok(String name, boolean cond) {
        if (cond) {
            pass++;
            System.out.println("  ok   " + name);
        } else {
            fail++;
            System.out.println("  FAIL " + name);
        }
    }
}
