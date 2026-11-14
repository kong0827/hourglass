package com.hourglass.dto;

import lombok.Data;

import javax.validation.constraints.NotBlank;
import javax.validation.constraints.Size;
import java.time.LocalDate;
import java.util.List;

@Data
public class MilestoneSaveRequest {

    @NotBlank
    private String reqId;
    @Size(max = 120)
    private String name;
    /** version / tasks / manual */
    @NotBlank
    private String kind;
    private String versionId;
    private List<String> taskIds;
    private LocalDate targetDate;
    private String ownerUserId;
    private Boolean keyMilestone;
    @Size(max = 500)
    private String note;
}
