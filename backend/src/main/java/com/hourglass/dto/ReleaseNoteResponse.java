package com.hourglass.dto;

import com.hourglass.entity.Demand;
import com.hourglass.entity.ProjectVersion;
import com.hourglass.entity.Task;
import lombok.Data;

import java.time.LocalDate;
import java.util.ArrayList;
import java.util.List;

/** M1 发布说明（T1.6）：发布动作生成的版本任务/需求清单 */
@Data
public class ReleaseNoteResponse {

    private ProjectVersion version;
    /** 发布说明生成日（未发布版本取当天） */
    private LocalDate generatedAt;

    private List<Task> tasks = new ArrayList<Task>();
    private List<Demand> demands = new ArrayList<Demand>();

    private Integer totalCount;
    private Integer doneCount;
    /** 已完成任务的累计实际工时（分钟） */
    private Integer workMinutes;
    /** 已完成任务预估合计（分钟） */
    private Integer estimateMinutes;
}
