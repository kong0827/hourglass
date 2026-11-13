package com.hourglass.mapper;

import com.hourglass.entity.DemandDeliveryJudgement;
import org.apache.ibatis.annotations.Mapper;
import org.apache.ibatis.annotations.Param;

import java.util.List;

@Mapper
public interface DemandDeliveryJudgementMapper {

    /** 当前生效判定；无生效记录返回 null */
    DemandDeliveryJudgement selectActive(@Param("workspaceId") String workspaceId,
                                         @Param("demandId") String demandId);

    List<DemandDeliveryJudgement> selectHistory(@Param("workspaceId") String workspaceId,
                                                @Param("demandId") String demandId,
                                                @Param("offset") int offset, @Param("limit") int limit);

    int countHistory(@Param("workspaceId") String workspaceId, @Param("demandId") String demandId);

    int insert(DemandDeliveryJudgement judgement);

    /** 只撤销当前生效记录；返回 0 表示已被其他操作撤销 */
    int revoke(@Param("id") Long id, @Param("revokedByUserId") String revokedByUserId,
               @Param("revokedByName") String revokedByName, @Param("revokeReason") String revokeReason);

    int deleteByDemand(@Param("workspaceId") String workspaceId, @Param("demandId") String demandId);

    int deleteByReq(@Param("workspaceId") String workspaceId, @Param("reqId") String reqId);

    int deleteByWorkspace(@Param("workspaceId") String workspaceId);
}
