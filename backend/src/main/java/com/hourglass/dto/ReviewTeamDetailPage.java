package com.hourglass.dto;

import lombok.Data;

import java.util.ArrayList;
import java.util.List;

/** 统计矩阵某一子项的就地展开明细：只回传前若干条，总数单独给。 */
@Data
public class ReviewTeamDetailPage {
    private String key;
    private int total;
    private int limit;
    private List<ReviewTeamResponse.DetailItem> items = new ArrayList<ReviewTeamResponse.DetailItem>();
}
