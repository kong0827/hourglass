package com.hourglass.dto;

import lombok.Data;

import java.util.List;

/** 项目手动排序请求：ids 为空间内全部项目的新顺序（含已归档，服务端整体重编号） */
@Data
public class ReqOrderRequest {

    private List<String> ids;
}
