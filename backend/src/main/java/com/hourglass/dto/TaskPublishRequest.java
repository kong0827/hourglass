package com.hourglass.dto;

import lombok.Data;
import javax.validation.constraints.Size;
import java.time.LocalDate;

@Data
public class TaskPublishRequest {
    private LocalDate publishedOn;
    @Size(max = 500)
    private String reason;
}
