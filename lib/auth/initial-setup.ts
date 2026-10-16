import { z } from "zod";

export const initialAdminSchema = z
  .object({
    displayName: z.string().trim().min(1, "请输入管理员名称").max(80, "名称最多 80 个字符"),
    email: z.string().trim().toLowerCase().max(254, "邮箱地址过长")
      .regex(/^[^\s@]+@[^\s@]+\.[^\s@]+$/, "邮箱格式不正确"),
    password: z.string().min(8, "密码至少需要 8 位").max(128, "密码最多 128 位")
      .refine((value) => value.trim().length > 0, "密码不能全为空格"),
    confirmPassword: z.string().max(128, "密码最多 128 位"),
  })
  .strict()
  .refine((value) => value.password === value.confirmPassword, {
    message: "两次输入的密码不一致",
    path: ["confirmPassword"],
  });

export type InitialAdminInput = z.infer<typeof initialAdminSchema>;
