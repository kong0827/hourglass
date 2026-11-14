package com.hourglass.mapper;

import com.hourglass.entity.AiSharedSetting;
import org.apache.ibatis.annotations.Mapper;
import org.apache.ibatis.annotations.Param;

@Mapper
public interface AiSharedSettingMapper {

    AiSharedSetting select(@Param("scope") String scope, @Param("scopeId") String scopeId);

    int upsert(AiSharedSetting setting);
}
