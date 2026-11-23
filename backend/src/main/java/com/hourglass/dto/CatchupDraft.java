package com.hourglass.dto;

import lombok.Data;

import java.util.ArrayList;
import java.util.List;

/** 一条补记草稿（工作项）。 */
@Data
public class CatchupDraft {

    private String key;
    private String taskId;
    private Integer itemNo;
    private String title;
    private String project;
    private String type;
    private String typeLabel;
    private String status;
    private String statusLabel;
    private Double hours;
    private String confidence;
    /** 上周提交时未处理/跳过，本周承接继续确认 */
    private Boolean carried;
    private String duplicate;
    private String question;
    private String why;
    private List<CatchupEvidence> evidence = new ArrayList<CatchupEvidence>();
    /** pending / accepted / skipped / merged / answered / edited */
    private String decision;
    private String answer;
    private String editedTitle;
    private String note;
}
