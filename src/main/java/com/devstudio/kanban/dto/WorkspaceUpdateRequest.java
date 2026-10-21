package com.devstudio.kanban.dto;

import lombok.Data;

import javax.validation.constraints.NotBlank;
import javax.validation.constraints.Pattern;
import javax.validation.constraints.Size;

@Data
public class WorkspaceUpdateRequest {

    @NotBlank(message = "请填写空间名称")
    @Size(max = 20, message = "空间名称不能超过 20 字")
    private String name;

    @Size(max = 255, message = "推送地址过长")
    private String notifyWebhook;

    /** O-1：推送渠道下沉到空间级。webhook / serverchan / pushplus；空=跟随全局 NOTIFY_TYPE */
    @Pattern(regexp = "webhook|serverchan|pushplus|", message = "推送渠道不合法")
    private String notifyChannel;

    /** O-1：空间级推送开关。null=跟随全局 app.notify.enabled */
    private Boolean notifyEnabled;

    /** O-1：Server 酱 SendKey / PushPlus token；空=用全局 NOTIFY_TOKEN */
    @Size(max = 64, message = "推送 token 过长")
    private String notifyToken;
}
