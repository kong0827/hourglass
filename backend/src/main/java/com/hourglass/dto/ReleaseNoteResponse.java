package com.hourglass.dto;

import com.hourglass.entity.Demand;
import com.hourglass.entity.ProjectVersion;
import com.hourglass.entity.Task;
import lombok.Data;

import java.time.LocalDate;
import java.time.LocalDateTime;
import java.util.ArrayList;
import java.util.List;

/** 发布说明：成功发布快照，或明确标识为非发布证据的动态范围。 */
@Data
public class ReleaseNoteResponse {

    private ProjectVersion version;
    /** release_snapshot / no_release_record / planned_scope；仅第一种是实际发布证据 */
    private String evidenceKind;
    private String releaseRecordId;
    /** 发布记录写入时刻；动态统计不提供 */
    private LocalDateTime recordedAt;
    /** 快照取记录的发布日；动态统计沿用版本上线日或当天 */
    private LocalDate generatedAt;

    private List<Task> tasks = new ArrayList<Task>();
    private List<Demand> demands = new ArrayList<Demand>();

    private Integer totalCount;
    private Integer doneCount;
    /** 清单任务实际工时合计（分钟）；release_snapshot 仅包含已发布条目 */
    private Integer workMinutes;
    /** 清单任务预估合计（分钟）；动态范围不代表实际交付 */
    private Integer estimateMinutes;
}
