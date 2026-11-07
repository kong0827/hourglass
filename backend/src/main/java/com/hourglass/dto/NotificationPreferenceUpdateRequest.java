package com.hourglass.dto;

import lombok.Data;

import javax.validation.Valid;
import javax.validation.constraints.NotEmpty;
import java.util.List;

@Data
public class NotificationPreferenceUpdateRequest {

    @NotEmpty(message = "通知偏好不能为空")
    @Valid
    private List<NotificationPreferenceItem> preferences;
}
