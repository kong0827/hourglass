package com.hourglass.dto;

import lombok.Data;
import javax.validation.constraints.Pattern;
import javax.validation.constraints.Size;
import java.time.LocalDateTime;
import java.util.List;
import javax.validation.constraints.NotNull;
import javax.validation.constraints.NotBlank;

@Data
public class ReleasePlanRequest {
    @Size(max = 32)
    private String id;
    @NotNull @Size(max = 500)
    private List<@NotBlank @Size(max = 32) String> plannedTaskIds;
    @NotBlank @Pattern(regexp = "production|staging|test")
    private String environment;
    @NotNull @Size(max = 500)
    private List<@NotBlank @Size(max = 128) String> targetKeys;
    @NotBlank @Pattern(regexp = "full|partial|unknown")
    private String coverage;
    private LocalDateTime plannedAt;
    private String ownerUserId;
    @Size(max = 2000)
    private String notes;
    @Size(max = 1000)
    private String risks;
    @Pattern(regexp = "draft|ready|canceled")
    private String status;
    private Long revision;
    @Size(max = 500)
    private String reason;
}
