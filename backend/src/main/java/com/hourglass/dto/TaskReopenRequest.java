package com.hourglass.dto;

import lombok.Data;

/** 取消完成：默认回到完成前所在列，流转规则与普通移动一致 */
@Data
public class TaskReopenRequest {

    /** 「已完成 → 其他列」默认需填原因 */
    private String reason;

    /** 空间主 / 管理员强制越过规则 */
    private Boolean force;
}
