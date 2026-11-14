package com.hourglass.dto;

import lombok.Data;

import java.util.List;
import java.util.Map;

/** 交付说明人工层保存：只存文字与生成控制，数字一律实时派生，不接受前端回传。 */
@Data
public class DeliveryNoteSaveRequest {

    private String audience;
    private String supportContact;
    private String acceptanceNote;
    private Map<String, Object> options;
    private Map<String, String> narratives;
    private List<String> confirmed;
    /** 乐观锁：与服务端 revision 不一致时拒绝覆盖 */
    private Long revision;
}