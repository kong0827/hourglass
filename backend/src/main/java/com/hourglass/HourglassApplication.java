package com.hourglass;

import org.springframework.boot.SpringApplication;
import org.springframework.boot.autoconfigure.SpringBootApplication;
import org.springframework.scheduling.annotation.EnableScheduling;

import java.util.TimeZone;

@EnableScheduling
@SpringBootApplication
public class HourglassApplication {

    public static void main(String[] args) {
        /* serverTimezone 只作用于 JDBC 连接；定时任务、LocalDateTime.now() 取的是 JVM 默认时区，
           不固定的话 UTC 部署上 10:00 逾期提醒、9:05 发布准备、17:00 周报都会整体偏移。 */
        TimeZone.setDefault(TimeZone.getTimeZone("Asia/Shanghai"));
        SpringApplication.run(HourglassApplication.class, args);
    }
}
