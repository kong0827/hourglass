package com.devstudio.kanban.dto;

import lombok.Data;

import javax.validation.constraints.Pattern;
import javax.validation.constraints.Size;

@Data
public class WorkspaceUpdateRequest {

    /**
     * 更新时可只提交要改的字段：name 为空 / 不传 = 保持原值。
     * （空间信息面板只提交 name，推送面板只提交推送字段，两个入口互不覆盖。）
     */
    @Size(max = 20, message = "空间名称不能超过 20 字")
    private String name;

    @Size(max = 255, message = "推送地址过长")
    private String notifyWebhook;

    /** O-1：推送渠道下沉到空间级。webhook / serverchan / pushplus；空=跟随全局 NOTIFY_TYPE */
    @Pattern(regexp = "webhook|serverchan|pushplus|", message = "推送渠道不合法")
    private String notifyChannel;

    /** O-1：空间级推送开关。null=跟随全局 app.notify.enabled */
    private Boolean notifyEnabled;

    /** BUG-12：站内通知开关。null=启用；与外部推送开关相互独立 */
    private Boolean notifyInAppEnabled;

    /** O-1：Server 酱 SendKey / PushPlus token；空=用全局 NOTIFY_TOKEN */
    @Size(max = 64, message = "推送 token 过长")
    private String notifyToken;

    /**
     * 显式清除本空间已保存的 Token。
     * 不传 / false 且 notifyToken 为空时表示“保持原值”，
     * 避免只改空间名或切换渠道时把已有 Token 静默写空。
     */
    private Boolean clearToken;
}
