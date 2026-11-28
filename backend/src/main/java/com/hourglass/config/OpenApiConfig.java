package com.hourglass.config;

import io.swagger.v3.oas.models.Components;
import io.swagger.v3.oas.models.OpenAPI;
import io.swagger.v3.oas.models.Operation;
import io.swagger.v3.oas.models.PathItem;
import io.swagger.v3.oas.models.info.Info;
import io.swagger.v3.oas.models.parameters.Parameter;
import io.swagger.v3.oas.models.parameters.QueryParameter;
import io.swagger.v3.oas.models.media.StringSchema;
import io.swagger.v3.oas.models.security.SecurityRequirement;
import io.swagger.v3.oas.models.security.SecurityScheme;
import org.springdoc.core.customizers.OpenApiCustomiser;
import org.springframework.context.annotation.Bean;
import org.springframework.context.annotation.Configuration;

import java.util.ArrayList;
import java.util.Arrays;
import java.util.List;

/**
 * 对外 OpenAPI：路径白名单在 application.yml，这里补 Bearer 方案并裁掉非白名单操作。
 * GET 全部保留；写操作只保留 {@link ApiTokenWritePolicy} 允许的 POST。
 */
@Configuration
public class OpenApiConfig {

    /** springdoc 认不出自定义解析器，会把 @BoardFilter BoardQuery 摊成这些 query 参数；名称与解析器一致 */
    private static final String[][] BOARD_FILTERS = {
            {"q", "关键字（标题 / 编号，WI-001、wi1、纯数字均可）"},
            {"owners", "负责人显示名，逗号分隔"},
            {"testOwners", "测试负责人显示名，逗号分隔；__none 表示待领取"},
            {"pris", "优先级，逗号分隔"},
            {"cats", "分类 ID，逗号分隔"},
            {"reqs", "需求 ID，逗号分隔；__none 表示未归类"},
            {"tags", "标签名，逗号分隔，命中任意一个即匹配"},
            {"types", "工作项类型 story/task/bug/epic，逗号分隔"},
            {"versions", "影响版本 ID，逗号分隔；__none 表示待规划"},
            {"columns", "看板列（状态）ID，逗号分隔"},
            {"completion", "open=未完成，done=已完成，不传=全部"},
            {"pubState", "published / unpublished"},
            {"donePubState", "已完成列专用发布态：published / unpublished"},
            {"due", "over / today / soon"},
            {"focus", "true=今日聚焦（逾期 + 今天到期 + 进行中的 P0）"},
            {"blocked", "true=仅看被阻塞的工作项"},
            {"noDue", "true=仅看没有截止日期的工作项"},
            {"dueFrom", "截止日期下界 yyyy-MM-dd（含端点）"},
            {"dueTo", "截止日期上界 yyyy-MM-dd（含端点）"},
            {"startFrom", "开始日期下界 yyyy-MM-dd（含端点）"},
            {"startTo", "开始日期上界 yyyy-MM-dd（含端点）"},
            {"doneScope", "已完成列范围：week（默认）/ all"},
            {"doneLimit", "已完成列条数 1–100"},
            {"doneOffset", "已完成列偏移"},
            {"openLimit", "未完成列首屏条数 1–100"}
    };

    @Bean
    public OpenAPI hourglassOpenApi() {
        return new OpenAPI()
                .info(new Info()
                        .title("沙漏 API（P0）")
                        .version("0.1")
                        .description("以个人访问令牌（Authorization: Bearer hg_...）访问空间、项目、"
                                + "工作项、需求、文档与用例数据。只读令牌只能查询；读写令牌额外开放建工作项、"
                                + "工作项列流转、提需求与需求流转四类写操作。P0 不是稳定契约；"
                                + "字段口径见项目内《接口契约》。"))
                .components(new Components().addSecuritySchemes("bearerAuth",
                        new SecurityScheme()
                                .type(SecurityScheme.Type.HTTP)
                                .scheme("bearer")
                                .bearerFormat("hg_...")
                                .description("个人访问令牌，在个人设置 → 访问令牌创建（只读 / 读写）")))
                .addSecurityItem(new SecurityRequirement().addList("bearerAuth"));
    }

    @Bean
    public OpenApiCustomiser apiCustomiser() {
        return openApi -> {
            if (openApi.getPaths() == null) {
                return;
            }
            openApi.getPaths().entrySet().removeIf(entry -> {
                String path = entry.getKey();
                PathItem item = entry.getValue();
                item.setPut(writeOrNull(path, "PUT", item.getPut()));
                item.setPost(writeOrNull(path, "POST", item.getPost()));
                item.setDelete(writeOrNull(path, "DELETE", item.getDelete()));
                item.setPatch(writeOrNull(path, "PATCH", item.getPatch()));
                item.setHead(null);
                item.setOptions(null);
                item.setTrace(null);
                item.readOperations().forEach(OpenApiConfig::fixResolvedParameters);
                /* POST 的 @CurrentWorkspace 不会被 springdoc 摊成参数，单独补 workspace */
                ensureWorkspace(item.getPost());
                ensureWorkspace(item.getPut());
                ensureWorkspace(item.getPatch());
                ensureWorkspace(item.getDelete());
                return item.readOperations().isEmpty();
            });
        };
    }

    /** GET 由 paths-to-match 决定；非安全方法只留写白名单内的操作 */
    private static Operation writeOrNull(String path, String method, Operation operation) {
        if (operation == null) {
            return null;
        }
        return ApiTokenWritePolicy.allows(method, path) ? operation : null;
    }

    /**
     * 把 @CurrentWorkspace / @BoardFilter 解析出的参数还原成真实 query 参数：
     * 去掉 springdoc 误生成的 ctx / query，补 workspace 与各筛选项。
     */
    private static void fixResolvedParameters(Operation operation) {
        List<Parameter> params = operation.getParameters();
        if (params == null || params.isEmpty()) {
            return;
        }
        boolean hasCtx = false;
        boolean hasQuery = false;
        List<Parameter> kept = new ArrayList<Parameter>();
        for (Parameter param : params) {
            if ("ctx".equals(param.getName())) {
                hasCtx = true;
            } else if ("query".equals(param.getName())) {
                hasQuery = true;
            } else {
                kept.add(param);
            }
        }
        if (!hasCtx && !hasQuery) {
            return;
        }
        if (hasCtx && !containsName(kept, "workspace")) {
            kept.add(new QueryParameter().name("workspace").required(false)
                    .description("空间 ID；不传沿用上次使用的空间，再退回个人空间")
                    .schema(new StringSchema()));
        }
        if (hasQuery && !containsName(kept, "q")) {
            for (String[] filter : BOARD_FILTERS) {
                kept.add(new QueryParameter().name(filter[0]).required(false)
                        .description(filter[1]).schema(new StringSchema()));
            }
        }
        operation.setParameters(kept);
    }

    private static boolean containsName(List<Parameter> params, String name) {
        for (Parameter param : params) {
            if (name.equals(param.getName())) {
                return true;
            }
        }
        return false;
    }

    /** 写接口必须能显式带 workspace，否则文档上只能落到「上次使用的空间」 */
    private static void ensureWorkspace(Operation operation) {
        if (operation == null) {
            return;
        }
        List<Parameter> params = operation.getParameters();
        if (params == null) {
            params = new ArrayList<Parameter>();
            operation.setParameters(params);
        }
        if (!containsName(params, "workspace")) {
            params.add(new QueryParameter().name("workspace").required(false)
                    .description("空间 ID；不传沿用上次使用的空间，再退回个人空间")
                    .schema(new StringSchema()));
        }
    }
}