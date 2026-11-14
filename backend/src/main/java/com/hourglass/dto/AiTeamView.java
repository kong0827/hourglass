package com.hourglass.dto;

import lombok.Data;

/** 成员视角看到的团队 / 空间共享 AI（只读，不含 Key 与掩码）。 */
@Data
public class AiTeamView {

    private boolean available;
    /** platform / workspace */
    private String scope;
    private String provider;
    private String model;
    /** 一句话说明来源与故障联系人 */
    private String status;
}
