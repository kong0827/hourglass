package com.hourglass.mapper;

import com.hourglass.entity.WeComCorp;
import org.apache.ibatis.annotations.Mapper;
import org.apache.ibatis.annotations.Param;

import java.util.List;

@Mapper
public interface WeComCorpMapper {

    WeComCorp selectById(String id);

    WeComCorp selectByCorpKey(String corpKey);

    WeComCorp selectByCorpId(String corpId);

    List<WeComCorp> selectAll();

    /** 至少被一个空间启用的企业：登录页选择器用，不暴露未启用的企业 */
    List<WeComCorp> selectActiveRegistered();

    List<WeComCorp> selectActiveByIds(@Param("corpIds") List<String> corpIds);

    int insert(WeComCorp corp);

    /** 只改名称/AgentId/回调地址/状态/备注/密钥（非空时），不改 CorpID 与 corpKey */
    int update(WeComCorp corp);

    int updateStatus(@Param("id") String id, @Param("status") String status);

    int deleteById(String id);
}