package com.hourglass.wecom;

import com.hourglass.common.Ids;
import com.hourglass.entity.WeComOauthState;
import com.hourglass.mapper.WeComOauthStateMapper;
import org.springframework.scheduling.annotation.Scheduled;
import org.springframework.stereotype.Service;

import java.time.LocalDateTime;

/**
 * OAuth state：一次一用，落库而不是放内存。
 * 单实例也落库——回调可能被用户刷新，内存消费并发下容易重复换码。
 */
@Service
public class WeComStateService {

    private final WeComOauthStateMapper mapper;
    private final WeComProperties props;

    public WeComStateService(WeComOauthStateMapper mapper, WeComProperties props) {
        this.mapper = mapper;
        this.props = props;
    }

    public String issue(String purpose, String corpId, String userId, String target,
                        String workspaceId, String clientIp) {
        WeComOauthState row = new WeComOauthState();
        row.setState(Ids.genToken());
        row.setPurpose(purpose);
        row.setCorpId(corpId);
        row.setUserId(userId);
        row.setTarget(WeComSafePath.of(target, "/"));
        row.setWorkspaceId(workspaceId);
        row.setExpiresAt(LocalDateTime.now().plusSeconds(Math.max(60, props.getStateTtlSeconds())));
        row.setClientIp(clientIp);
        row.setCreatedAt(LocalDateTime.now());
        mapper.insert(row);
        return row.getState();
    }

    /** 原子消费；已用或过期返回 null（回调页刷新、并发回调都落到这里） */
    public WeComOauthState consume(String state) {
        if (state == null || state.trim().isEmpty() || state.length() > 64) {
            return null;
        }
        if (mapper.consume(state.trim()) == 0) {
            return null;
        }
        return mapper.selectByState(state.trim());
    }

    @Scheduled(cron = "0 35 3 * * *")
    public void cleanup() {
        try {
            mapper.deleteExpired(LocalDateTime.now().minusDays(1));
        } catch (Exception ignored) {
            /* 清理失败不影响登录 */
        }
    }
}