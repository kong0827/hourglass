package com.hourglass.dto;

import lombok.Data;

import java.util.List;

@Data
public class SubtaskReorderRequest {

    /** 任务内检查项的全排列（id 列表），服务端整体重编号 */
    private List<Long> ids;
}