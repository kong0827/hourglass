package com.hourglass.dto;

import lombok.Data;
import java.util.List;

@Data
public class MemberLabelOptions {
    private List<String> roleTitles;
    private List<String> companyNames;
}
