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
    /** review/pass/plan/rej，null = 全部 */
    private String status;
    private String q;
    private List<String> pris = new ArrayList<String>();
    private List<String> kinds = new ArrayList<String>();
    /** 项目ID列表 */
    private List<String> reqs = new ArrayList<String>();
    /** default/priority/expect/wsjf/created */
    private String sort = "default";
    private int offset;
    private int limit = 50;
    /** 项目可见范围：null 表示不过滤（owner/admin/viewer） */
    private String viewerId;
}
