package com.hourglass.entity;

import com.fasterxml.jackson.annotation.JsonIgnore;
import lombok.Data;

import java.time.LocalDateTime;

@Data
public class AppUser {

    private String id;
    private String username;
    /** never 序列化给前端 */
    @JsonIgnore
    private String passwordHash;
    private String displayName;
    /** 个人邮箱：事件邮件收件地址；未填写时只发站内通知 */
    private String email;
    /** admin/user（只管账号，不等于空间权限） */
    private String role;
    /** 1=已停用：不可登录、会话即刻失效；历史数据与负责人引用保留（A4 账号治理） */
    private Boolean disabled;
    /** 会话代次：密码/角色变更时递增，旧会话失效（不输出给前端） */
    @JsonIgnore
    private Long sessionVersion;
    /** 每天几点开始计入工时（0-23，默认 9） */
    private Integer workStartHour;
    /** 每天几点之后不再计入（1-24，24=当天 24:00，默认 18） */
    private Integer workEndHour;
    /** 每人每天最多计入几小时（1-24，默认 8） */
    private Integer workMaxHours;
    /** AI 厂商：deepseek/qwen/moonshot/zhipu/hunyuan/openai/ollama/custom */
    private String aiProvider;
    /** API 基址（不含 /chat/completions） */
    private String aiBaseUrl;
    /** 模型名 */
    private String aiModel;
    /** API Key 密文（AES-GCM，v1: 前缀）—— 永不序列化给前端，接口只给掩码 */
    @JsonIgnore
    private String aiApiKey;
    /** 是否启用个人 AI（关闭时不发任何外部请求） */
    private Boolean aiEnabled;
    private String lastWorkspaceId;
    private LocalDateTime createdAt;
    private LocalDateTime updatedAt;
}
