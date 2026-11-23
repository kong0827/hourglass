package com.hourglass.mapper;

import com.hourglass.entity.MailDelivery;
import org.apache.ibatis.annotations.Mapper;
import org.apache.ibatis.annotations.Param;

import java.time.LocalDateTime;
import java.util.List;

@Mapper
public interface MailDeliveryMapper {

    int insert(MailDelivery delivery);

    List<MailDelivery> selectDue(@Param("now") LocalDateTime now, @Param("limit") int limit);

    /** 抢占一行待发行：成功返回 1，多实例并发时只有一个能拿到 */
    int claim(@Param("id") Long id, @Param("now") LocalDateTime now,
              @Param("claimUntil") LocalDateTime claimUntil);

    int markSent(@Param("id") Long id, @Param("sentAt") LocalDateTime sentAt);

    int markAttemptFailed(@Param("id") Long id, @Param("status") String status,
                          @Param("attempts") int attempts,
                          @Param("nextAttemptAt") LocalDateTime nextAttemptAt,
                          @Param("lastError") String lastError);

    /** 收口最后一次抢占后停在 sending 的行（进程在落库前退出），租约到期才处理 */
    int failExpiredSending(@Param("maxAttempts") int maxAttempts, @Param("now") LocalDateTime now,
                           @Param("message") String message);

    /** 任务/需求删除时取消尚未发出的邮件，避免删除后继续外发 */
    int deleteByReferenceIds(@Param("referenceIds") List<String> referenceIds);

    /** 清空空间时按任务/需求引用取消待发邮件 */
    int deleteByWorkspaceReferences(@Param("workspaceId") String workspaceId);
}
