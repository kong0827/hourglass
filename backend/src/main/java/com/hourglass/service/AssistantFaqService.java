package com.hourglass.service;

import com.fasterxml.jackson.core.type.TypeReference;
import com.fasterxml.jackson.databind.ObjectMapper;
import org.slf4j.Logger;
import org.slf4j.LoggerFactory;
import org.springframework.core.io.ClassPathResource;
import org.springframework.stereotype.Service;

import java.io.InputStream;
import java.util.ArrayList;
import java.util.Collections;
import java.util.List;

/**
 * 精选 FAQ：高频产品问题不调模型，直接返回人工维护的答案与入口。
 *
 * <p>FAQ 只解决"能答得准"的部分；模型只拿这些条目和页面地图做依据，
 * 手册里没有的内容必须说不知道，避免编造菜单名。
 */
@Service
public class AssistantFaqService {

    private static final Logger log = LoggerFactory.getLogger(AssistantFaqService.class);
    private final List<Entry> entries;

    public AssistantFaqService() {
        this.entries = load();
    }

    public static class Entry {
        public String id;
        public String title;
        public List<String> keywords = new ArrayList<String>();
        public String answer;
        public List<String> links = new ArrayList<String>();
    }

    public List<Entry> entries() {
        return entries;
    }

    /** 最长关键词优先；命中多个条目时取关键词总长度更高的一条 */
    public Entry match(String question) {
        String q = normalize(question);
        if (q.length() < 2) {
            return null;
        }
        Entry best = null;
        int bestScore = 0;
        for (Entry e : entries) {
            int score = 0;
            for (String keyword : e.keywords) {
                String k = normalize(keyword);
                if (k.length() >= 2 && q.contains(k)) {
                    score += k.length();
                }
            }
            if (score > bestScore) {
                bestScore = score;
                best = e;
            }
        }
        return bestScore >= 2 ? best : null;
    }

    /** 拼进系统提示词的帮助摘录：只给标题、答案和可用入口 */
    public String promptDigest() {
        StringBuilder sb = new StringBuilder();
        for (Entry e : entries) {
            sb.append("【").append(e.title).append("】").append(e.answer);
            if (!e.links.isEmpty()) {
                sb.append(" 可用入口：").append(String.join("、", e.links));
            }
            sb.append("\n");
        }
        return sb.toString();
    }

    private static String normalize(String s) {
        if (s == null) {
            return "";
        }
        return s.replaceAll("\\s+", "").toLowerCase();
    }

    private static List<Entry> load() {
        try (InputStream in = new ClassPathResource("assistant/faq.json").getInputStream()) {
            ObjectMapper om = new ObjectMapper();
            List<Entry> list = om.readValue(in, new TypeReference<List<Entry>>() { });
            return list == null ? Collections.<Entry>emptyList() : list;
        } catch (Exception e) {
            /* 资源缺失不能让助手整体不可用：退化为只靠页面地图回答 */
            log.warn("助手 FAQ 加载失败，降级为无精选条目", e);
            return Collections.emptyList();
        }
    }
}
