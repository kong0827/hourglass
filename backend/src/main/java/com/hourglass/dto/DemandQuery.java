package com.hourglass.dto;

import lombok.Data;

import java.util.ArrayList;
import java.util.List;

/**
 * 需求池分页查询条件（看板单列滚动加载 / 列表模式共用）。
 */
@Data
public class DemandQuery {

    private String workspaceId;
    private String reqId;
    /** review/pass/plan/done/closed，null = 全部；旧 rej/canceled 输入归一为 closed */
    private String status;
    /** 派生阶段：waiting/active（已排期）、donePending/delivered（已完成） */
    private String deliveryStage;
    /** 目标版本；__none 表示未指定版本 */
    private String versionId;
    private String closeReason;
    private String closeStage;
    /** high/dueSoon/risk */
    private String focus;
    private String q;
    /** 负责人账号ID：评审人优先，未评审时回落创建人 */
    private String owner;
    /** 期望交付日期区间（全局搜索的日期维度） */
    private java.time.LocalDate expectFrom;
    private java.time.LocalDate expectTo;
    private List<String> pris = new ArrayList<String>();
    private List<String> kinds = new ArrayList<String>();
    /** 模块名列表（空串表示未指定模块） */
    private List<String> cats = new ArrayList<String>();
    /** 项目ID列表 */
    private List<String> reqs = new ArrayList<String>();
    /** default/priority/expect/wsjf/created */
    private String sort = "default";
    private int offset;
    private int limit = 50;
    /** 项目可见范围：null 表示不过滤（owner/admin/viewer） */
    private String viewerId;

    /** 搜索词里的需求编号（DM-001 / dm1 / 纯数字）；不是编号形态返回 null，走文本匹配 */
    public Integer getItemNo() {
        return com.hourglass.common.Nos.parseDemand(q);
    }
}
