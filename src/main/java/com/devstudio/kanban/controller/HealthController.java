package com.devstudio.kanban.controller;

import com.devstudio.kanban.common.ApiResult;
import org.slf4j.Logger;
import org.slf4j.LoggerFactory;
import org.springframework.jdbc.core.JdbcTemplate;
import org.springframework.web.bind.annotation.GetMapping;
import org.springframework.web.bind.annotation.RestController;

import java.time.LocalDateTime;
import java.time.format.DateTimeFormatter;
import java.util.LinkedHashMap;
import java.util.Map;

/**
 * 健康检查：同时验证应用与数据库连通性，供部署验收使用
 */
@RestController
public class HealthController {

    private static final Logger log = LoggerFactory.getLogger(HealthController.class);
    private static final DateTimeFormatter TIME_FORMAT = DateTimeFormatter.ofPattern("yyyy-MM-dd HH:mm:ss");

    private final JdbcTemplate jdbcTemplate;

    public HealthController(JdbcTemplate jdbcTemplate) {
        this.jdbcTemplate = jdbcTemplate;
    }

    @GetMapping("/api/health")
    public ApiResult<Map<String, Object>> health() {
        Map<String, Object> data = new LinkedHashMap<String, Object>();
        data.put("app", "devstudio-kanban-server");
        data.put("time", LocalDateTime.now().format(TIME_FORMAT));
        try {
            jdbcTemplate.queryForObject("SELECT 1", Integer.class);
            data.put("db", "up");
        } catch (Exception e) {
            log.error("数据库连通检查失败", e);
            data.put("db", "down");
        }
        return ApiResult.ok(data);
    }
}
