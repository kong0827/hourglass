package com.devstudio.kanban.mapper;

import com.devstudio.kanban.entity.MailDelivery;
import org.apache.ibatis.annotations.Mapper;
import org.apache.ibatis.annotations.Param;

import java.time.LocalDateTime;
import java.util.List;

@Mapper
public interface MailDeliveryMapper {

    int insert(MailDelivery delivery);

    List<MailDelivery> selectDue(@Param("now") LocalDateTime now, @Param("limit") int limit);

    int markSent(@Param("id") Long id, @Param("sentAt") LocalDateTime sentAt);

    int markAttemptFailed(@Param("id") Long id, @Param("status") String status,
                          @Param("attempts") int attempts,
                          @Param("nextAttemptAt") LocalDateTime nextAttemptAt,
                          @Param("lastError") String lastError);
}
