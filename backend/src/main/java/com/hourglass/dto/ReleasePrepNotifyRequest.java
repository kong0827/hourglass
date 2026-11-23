package com.hourglass.dto;

import lombok.Data;

import java.util.ArrayList;
import java.util.List;

/** 通知成员请求：范围、指定成员、是否只发未确认、渠道。 */
@Data
public class ReleasePrepNotifyRequest {
    /** all / owners / custom */
    private String scope = "all";
    private List<String> userIds = new ArrayList<String>();
    private Boolean onlyUnconfirmed = Boolean.FALSE;
    private List<String> channels = new ArrayList<String>();
    /** 选填补充说明，最多 200 字；与固定事实句一起进入站内/邮件/群，不替换模板 */
    private String note;
}
