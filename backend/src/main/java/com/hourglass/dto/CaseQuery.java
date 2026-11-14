package com.hourglass.dto;

import lombok.Data;

import java.util.List;

/**
 * 测试用例分页查询条件。
 */
@Data
public class CaseQuery {

    private String workspaceId;
    private String reqId;
    /** passed/failed/blocked/skipped/__untested，null = 全部 */
    private String status;
    /** 模块名 / __none（自由文本口径，保留给旧客户端与 CSV） */
    private String module;
    /** 目录节点 ID / __none（未归类）；与 module 二选一，节点口径优先 */
    private String moduleId;
    /** 目录筛选是否含子节点用例（服务层展开为 moduleIds） */
    private boolean moduleSub;
    /** 服务层展开后的目录范围（moduleId + 子树），XML 只用它 */
    private List<String> moduleIds;
    /** 优先级 / __none */
    private String pri;
    /** 最近执行人 / __none */
    private String owner;
    /** 主需求 ID / __none（未关联需求） */
    private String demandId;
    /** 用例集 ID / __none（未加入任何可见分组） */
    private String setId;
    /** 仅看关联缺陷仍有效未完成（未删除、未进入完成列）的用例 */
    private boolean bugOnly;
    /** 回归集谓词：最近失败 / 阻塞，或关联缺陷仍未关闭（动态分组规则用） */
    private boolean regression;
    private String q;
    /** 搜索范围：false 只搜标题/编号/模块，true 才搜前置、测试数据、步骤等大字段 */
    private boolean searchWide;
    /** 排序字段白名单：created / updated / executed / no / pri / module / status */
    private String sort = "created";
    /** asc / desc */
    private String sortDir = "desc";
    /** 分组计数用的维度：module / priority / status / owner / demand / set */
    private String groupBy;
    /** 当前查看者：个人分组只对自己可见 */
    private String viewerId;
    /** 「全选筛选结果」后取消勾选的行 */
    private List<String> excludeIds;
    private int offset;
    private int limit = 100;

    /** 搜索词里的用例编号（TC-001 / tc1 / 纯数字）；不是编号形态返回 null，走文本匹配 */
    public Integer getCaseNo() {
        return com.hourglass.common.Nos.parseCase(q);
    }
}