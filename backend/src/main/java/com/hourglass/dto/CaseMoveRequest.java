package com.hourglass.dto;

import lombok.Data;

import javax.validation.Valid;

/** 批量移动用例到目录节点：单归属，原节点移出；编号与执行历史不变 */
@Data
public class CaseMoveRequest {

    @Valid
    private CaseSelection selection;

    /** 目标节点 ID；空 = 移出目录（未归类） */
    private String moduleId;
}