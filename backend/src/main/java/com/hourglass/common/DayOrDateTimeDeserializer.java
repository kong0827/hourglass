package com.hourglass.common;

import com.fasterxml.jackson.core.JsonParser;
import com.fasterxml.jackson.databind.DeserializationContext;
import com.fasterxml.jackson.databind.JsonDeserializer;
import java.io.IOException;
import java.time.LocalDate;
import java.time.LocalDateTime;

/** 完成时间已是分钟级，但对外契约仍接受纯日期：按当天 00:00 落库，旧调用方不被打断 */
public class DayOrDateTimeDeserializer extends JsonDeserializer<LocalDateTime> {
    @Override
    public LocalDateTime deserialize(JsonParser parser, DeserializationContext context) throws IOException {
        String text = parser.getValueAsString();
        if (text == null) return null;
        text = text.trim();
        if (text.isEmpty()) return null;
        if (text.length() == 10) return LocalDate.parse(text).atStartOfDay();
        return LocalDateTime.parse(text);
    }
}