"""
URL configuration for sistema-gestao project.

The `urlpatterns` list routes URLs to views. For more information please see:
    https://docs.djangoproject.com/en/6.1/topics/http/urls/
Examples:
Function views
    1. Add an import:  from my_app import views
    2. Add a URL to urlpatterns:  path('', views.home, name='home')
Class-based views
    1. Add an import:  from other_app.views import Home
    2. Add a URL to urlpatterns:  path('', Home.as_view(), name='home')
Including another URLconf
    1. Import the include() function: from django.urls import include, path
    2. Add a URL to urlpatterns:  path('blog/', include('blog.urls'))
"""
from django.urls import path
from apps.core.views import home, produtos, sobre
from apps.cronograma.views import cronograma
from apps.temporizador.views import temporizador

urlpatterns = [
    path('', home, name='home'),
    path('produtos/', produtos, name='produtos'),
    path('cronograma/', cronograma, name='cronograma'),
    path('temporizador/', temporizador, name='temporizador'),
    path('sobre/', sobre, name='sobre'),
]
