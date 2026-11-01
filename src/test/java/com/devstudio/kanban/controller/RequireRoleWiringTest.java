package com.devstudio.kanban.controller;

import org.junit.jupiter.api.Test;

import java.nio.charset.StandardCharsets;
import java.nio.file.Files;
import java.nio.file.Path;
import java.nio.file.Paths;
import java.util.ArrayList;
import java.util.List;

import static org.junit.jupiter.api.Assertions.assertFalse;
import static org.junit.jupiter.api.Assertions.assertTrue;

/**
 * @RequireRole 只在方法同时声明 @CurrentWorkspace 时才会被执行；
 * 这里静态扫描控制器源码，防止以后新增权限接口却漏掉 WorkspaceCtx 参数而静默放行。
 */
class RequireRoleWiringTest {

    @Test
    void everyRequireRoleMethodDeclaresCurrentWorkspace() throws Exception {
        Path dir = Paths.get("src/main/java/com/devstudio/kanban/controller");
        assertTrue(Files.isDirectory(dir), "controller 源码目录不存在");
        List<String> bad = new ArrayList<String>();
        int annotated = 0;
        for (Path p : Files.newDirectoryStream(dir, "*.java")) {
            String src = new String(Files.readAllBytes(p), StandardCharsets.UTF_8);
            int idx = 0;
            while ((idx = src.indexOf("@RequireRole", idx)) >= 0) {
                annotated++;
                int pub = src.indexOf("public ", idx);
                int brace = pub < 0 ? -1 : src.indexOf('{', pub);
                String signature = brace < 0 ? src.substring(idx) : src.substring(idx, brace);
                if (!signature.contains("@CurrentWorkspace")) {
                    bad.add(p.getFileName() + " 的 @RequireRole 方法缺少 @CurrentWorkspace 参数");
                }
                idx += 12;
            }
        }
        assertTrue(annotated > 0, "没有任何 @RequireRole 使用，检查是否被误删");
        assertFalse(!bad.isEmpty(), String.join("\n", bad));
    }
}
