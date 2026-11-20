package com.hourglass.mapper;

import com.hourglass.dto.MyDemandQuery;
import com.hourglass.entity.Demand;
import org.apache.ibatis.annotations.Mapper;
import org.apache.ibatis.annotations.Param;

import java.util.List;
import java.util.Map;

/**
 * 个人工作台的需求侧查询：我发起的 / 我关注的 / 待我评审。
 *
 * <p>三种视图共用 {@code myDemandWhere}，与列表的 total、状态计数保持同一口径；
 * 不改表结构，关注关系直接读 demand_watch。
 */
@Mapper
public interface MyWorkMapper {

    int countMyDemands(@Param("q") MyDemandQuery query);

    List<Demand> selectMyDemands(@Param("q") MyDemandQuery query);

    /** 状态 chip 计数：调用方把 status 置空，只看其它条件 */
    List<Map<String, Object>> countMyDemandStatuses(@Param("q") MyDemandQuery query);
}
