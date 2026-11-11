package com.hourglass.dto;

import lombok.Data;

/** 保存成员公司名；空值表示清除标注。 */
@Data
public class MemberCompanyRequest {

    private String companyName;
}
