import { useForm } from "react-hook-form";
import { zodResolver } from "@hookform/resolvers/zod";
import { Link, useNavigate } from "react-router-dom";
import { toast } from "sonner";
import { loginSchema, type LoginInput } from "@pnl/shared";
import { AuthLayout } from "@/layouts/AuthLayout";
import { Button, Field, Input } from "@/components/ui";
import { useLogin } from "@/hooks/useAuth";
import { errorMessage } from "@/lib/api";

export function LoginPage() {
  const navigate = useNavigate();
  const login = useLogin();
  const { register, handleSubmit, formState } = useForm<LoginInput>({ resolver: zodResolver(loginSchema) });

  const onSubmit = handleSubmit((v) =>
    login.mutate(v, { onSuccess: () => navigate("/"), onError: (e) => toast.error(errorMessage(e)) }),
  );

  return (
    <AuthLayout title="Login" subtitle="Apne brand dashboard mein login karo">
      <form onSubmit={onSubmit} className="space-y-4">
        <Field label="Email" htmlFor="email" error={formState.errors.email?.message}>
          <Input id="email" type="email" autoComplete="email" {...register("email")} />
        </Field>
        <Field label="Password" htmlFor="password" error={formState.errors.password?.message}>
          <Input id="password" type="password" autoComplete="current-password" {...register("password")} />
        </Field>
        <Button type="submit" className="w-full" loading={login.isPending}>
          Login
        </Button>
      </form>
      <p className="mt-6 text-center text-sm text-muted-foreground">
        Naya brand?{" "}
        <Link to="/signup" className="font-medium text-primary hover:underline">
          Signup karo
        </Link>
      </p>
    </AuthLayout>
  );
}
